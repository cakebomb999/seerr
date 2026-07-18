import type { RankedTmdbAnime } from '@server/api/anilist';
import { getMalToTmdbMap, resolveMalRankingToTmdb } from '@server/api/anilist';
import MyAnimeList from '@server/api/rating/myanimelist';
import logger from '@server/logger';
import { promises as fsp } from 'fs';
import path from 'path';

const REFRESH_INTERVAL_MSEC = 24 * 3600 * 1000;
const TOP_PAGES = 10; // 10 x 25 entries per ranking, deduped to ~150 shows

const LOCAL_PATH = process.env.CONFIG_DIRECTORY
  ? `${process.env.CONFIG_DIRECTORY}/mal-top-anime.json`
  : path.join(__dirname, '../../config/mal-top-anime.json');

export type MalTopSort = 'rating' | 'popularity';

interface MalTopCache {
  updatedAt: number;
  byRating: RankedTmdbAnime[];
  byPopularity: RankedTmdbAnime[];
}

let building: Promise<MalTopCache> | null = null;

const readFromDisk = async (): Promise<MalTopCache | null> => {
  try {
    const raw = await fsp.readFile(LOCAL_PATH, 'utf-8');
    return JSON.parse(raw) as MalTopCache;
  } catch {
    return null;
  }
};

const build = async (): Promise<MalTopCache> => {
  logger.info('Building MyAnimeList top anime list', { label: 'MyAnimeList' });

  const mal = new MyAnimeList();
  const malToTmdb = await getMalToTmdbMap();

  // Sequential, not parallel: one shared rate-limited client, and Jikan is
  // quick to 429 on bursts.
  const ratingRanking = await mal.getTopAnime(TOP_PAGES);
  const popularityRanking = await mal.getTopAnime(TOP_PAGES, 'bypopularity');

  const cache: MalTopCache = {
    updatedAt: Date.now(),
    byRating: resolveMalRankingToTmdb(ratingRanking, malToTmdb),
    byPopularity: resolveMalRankingToTmdb(popularityRanking, malToTmdb),
  };

  // A build that resolved nothing (e.g. Jikan returned an empty or errored
  // response) must not overwrite a previously good list. Throwing here lets
  // getCache fall back to the stale on-disk cache.
  if (cache.byRating.length === 0 && cache.byPopularity.length === 0) {
    throw new Error('MyAnimeList returned no top anime');
  }

  try {
    await fsp.writeFile(LOCAL_PATH, JSON.stringify(cache));
  } catch (e) {
    logger.warn('Failed to persist MyAnimeList top anime list', {
      label: 'MyAnimeList',
      errorMessage: e.message,
    });
  }

  logger.info(
    `Built MyAnimeList top anime list (${cache.byRating.length} rated, ${cache.byPopularity.length} popular)`,
    { label: 'MyAnimeList' }
  );

  return cache;
};

const getCache = async (): Promise<MalTopCache> => {
  const onDisk = await readFromDisk();
  if (onDisk && Date.now() - onDisk.updatedAt < REFRESH_INTERVAL_MSEC) {
    return onDisk;
  }

  // Only one build runs at a time; concurrent callers await the same promise.
  if (!building) {
    building = build().finally(() => {
      building = null;
    });
  }

  try {
    return await building;
  } catch (e) {
    // If the refresh fails, fall back to a stale list rather than nothing.
    if (onDisk) {
      logger.warn(
        'Using stale MyAnimeList top anime list after build failure',
        {
          label: 'MyAnimeList',
          errorMessage: e.message,
        }
      );
      return onDisk;
    }
    throw e;
  }
};

export const getMalTopAnime = async (
  sort: MalTopSort
): Promise<RankedTmdbAnime[]> => {
  const cache = await getCache();
  return sort === 'popularity' ? cache.byPopularity : cache.byRating;
};
