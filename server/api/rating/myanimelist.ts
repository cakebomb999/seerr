import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';

export interface MalRating {
  title: string;
  url: string;
  score: number;
  scoreCount: number;
}

interface JikanAnimeResponse {
  data: {
    mal_id: number;
    url: string;
    title: string;
    score: number | null;
    scored_by: number | null;
  };
}

interface JikanTopResponse {
  pagination: {
    has_next_page: boolean;
  };
  data: {
    mal_id: number;
    type: string | null;
    score: number | null;
    members: number | null;
  }[];
}

export interface MalRankedEntry {
  malId: number;
  score: number;
}

export type MalTopFilter = 'bypopularity' | undefined;

// Jikan is a community-run, unauthenticated MyAnimeList API.
// https://docs.api.jikan.moe
//
// While MyAnimeList is flaky upstream, Jikan responds with a 504 for many
// requests. Two workarounds noticeably raise the success rate:
//   1. Sending this exact Accept-Encoding value (order and members matter) hits
//      Jikan's cache instead of forcing an upstream fetch.
//   2. Forcing HTTP/1.1 avoids failures for requests that would otherwise be
//      negotiated over HTTP/2, which Jikan does not support.
// Jikan still replies with gzip, which Node decompresses transparently.
const JIKAN_ACCEPT_ENCODING = 'gzip, deflate, br, zstd';

class MyAnimeList extends ExternalAPI {
  constructor() {
    super(
      'https://api.jikan.moe/v4',
      {},
      {
        headers: {
          'Accept-Encoding': JIKAN_ACCEPT_ENCODING,
        },
        httpAgent: new HttpAgent({ keepAlive: true }),
        httpsAgent: new HttpsAgent({ keepAlive: true }),
        nodeCache: cacheManager.getCache('mal').data,
        rateLimit: {
          // Jikan is community-run; stay well under its limits.
          maxRPS: 1,
          maxRequests: 1,
        },
      }
    );
  }

  public async getRatingByMalId(malId: number): Promise<MalRating | null> {
    try {
      const response = await this.get<JikanAnimeResponse>(
        `/anime/${malId}`,
        undefined,
        43200
      );

      if (!response.data.score) {
        return null;
      }

      return {
        title: response.data.title,
        url: response.data.url,
        score: response.data.score,
        scoreCount: response.data.scored_by ?? 0,
      };
    } catch (e) {
      logger.debug('Failed to retrieve MyAnimeList rating', {
        label: 'MyAnimeList',
        errorMessage: e.message,
        malId,
      });
      return null;
    }
  }

  // Fetches the MAL top TV anime ranking, in order, across up to `pages` pages
  // (25 entries each). No filter ranks by score; 'bypopularity' by members.
  //
  // The `type` and `filter` query parameters are intentionally not sent to
  // Jikan: those variants bypass its cache and currently fail with a 504 when
  // MyAnimeList is unreachable. Instead we fetch the unfiltered ranking (served
  // from cache) and narrow it to TV entries, re-sorting by members when the
  // popularity ranking is requested.
  public async getTopAnime(
    pages: number,
    filter?: MalTopFilter
  ): Promise<MalRankedEntry[]> {
    const entries: { malId: number; score: number; members: number }[] = [];

    for (let page = 1; page <= pages; page++) {
      try {
        const response = await this.get<JikanTopResponse>(
          '/top/anime',
          {
            params: {
              page,
              limit: 25,
            },
          },
          43200
        );

        for (const entry of response.data) {
          if (entry.type === 'TV' && entry.score) {
            entries.push({
              malId: entry.mal_id,
              score: entry.score,
              members: entry.members ?? 0,
            });
          }
        }

        if (!response.pagination.has_next_page) {
          break;
        }
      } catch (e) {
        // On a transient failure (e.g. rate limit) keep the pages we have.
        logger.debug('Stopped fetching MyAnimeList top anime early', {
          label: 'MyAnimeList',
          errorMessage: e.message,
          page,
        });
        break;
      }
    }

    if (filter === 'bypopularity') {
      entries.sort((a, b) => b.members - a.members);
    }

    return entries.map(({ malId, score }) => ({ malId, score }));
  }
}

export default MyAnimeList;
