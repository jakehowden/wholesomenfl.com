import express, { Request, Response } from "express";
import NflPlayer from "../../models/NflPlayer";
import { getDb } from "../db/conn";

export const playersRouter = express.Router();

playersRouter.use(express.json());

playersRouter.get("/:ids", async (req: Request, res: Response) => {
    try {
        let ids = req.body as string[];
        let query = { sleeper_id: { $in: ids } };
        let db = getDb();
        let players = (db.collection("players").find(query)).toArray() as unknown as NflPlayer[];

        if (players) {
            res.status(200).send(players);
        }
    } catch (error) {
        res.status(404).send(`Unable to find matching document with id: ${req.params.id}`);
    }
});

playersRouter.post("/", async (req: Request, res: Response) => {
    try {
        let newPlayers = req.body as NflPlayer[];
        let db = getDb();
        let result = await db.collection("players").insertMany(newPlayers);

        result
            ? res.status(201).send(`Successfully created a new players`)
            : res.status(500).send("Failed to create a new player.");
    } catch (error) {
        console.error(error);
        res.status(400).send(error);
    }
});