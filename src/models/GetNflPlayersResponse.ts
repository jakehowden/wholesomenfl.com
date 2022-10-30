import { NflPlayer } from "./nflPlayer";

export interface GetNflPlayersResponse {
    data: { [key: string]: NflPlayer };
}

