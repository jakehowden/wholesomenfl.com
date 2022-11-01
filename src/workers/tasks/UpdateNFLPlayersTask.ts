import { Task } from "./Task";
import axios from 'axios';
import { GetNflPlayersResponse } from "../../models/GetNflPlayersResponse";
import NflPlayer from "../../models/NflPlayer";
import * as database from "../../database/database";
import express from "express";
import { playersRouter } from "../../database/players.router";

const app = express();
const port = 8080;

export class UpdateNFLPlayersTask extends Task {
    public async run() {
        try {
            const { data } = await axios.get<GetNflPlayersResponse>(
              'https://reqres.in/api/users',
              {
                headers: {
                  Accept: 'application/json',
                },
              },
            );
        
            let players: NflPlayer[];
            data.data.forEach((player: NflPlayer, key: string) => {
              players.push(new NflPlayer(key, player.first_name, player.last_name, player.position, player.team, player.status));
            });

            database.connect()
              .then(() => {
                app.use("/players", playersRouter);
      
                app.listen(port, () => {
                  console.log(`Server started at http://localhost:${port}`);
                });
            })
            .catch((error: Error) => {
                console.error("Database connection failed", error);
                process.exit();
            });
            
          } catch (error) {
            if (axios.isAxiosError(error)) {
              console.log('error message: ', error.message);
            } else {
              console.log('unexpected error: ', error);
            }
          }
    }
}