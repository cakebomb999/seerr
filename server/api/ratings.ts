import { type IMDBRating } from '@server/api/rating/imdbRadarrProxy';
import { type MalRating } from '@server/api/rating/myanimelist';
import { type RTRating } from '@server/api/rating/rottentomatoes';

export interface RatingResponse {
  rt?: RTRating;
  imdb?: IMDBRating;
  mal?: MalRating;
}
