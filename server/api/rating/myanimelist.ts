import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';

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

// Jikan is a community-run, unauthenticated MyAnimeList API.
// https://docs.api.jikan.moe
class MyAnimeList extends ExternalAPI {
  constructor() {
    super(
      'https://api.jikan.moe/v4',
      {},
      {
        nodeCache: cacheManager.getCache('mal').data,
        rateLimit: {
          maxRPS: 2,
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
}

export default MyAnimeList;
