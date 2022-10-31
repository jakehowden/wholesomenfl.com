import * as mongoDB from "mongodb";
import * as dotenv from "dotenv";
import NflPlayer from "../models/NflPlayer";

export const collections: { players?: mongoDB.Collection<NflPlayer> } = {}

export const connectToDatabase = async () => {
  dotenv.config();
 
  if(process.env.DB_CONN_STRING === undefined
    || process.env.DB_NAME === undefined
    || process.env.PLAYERS_COLLECTION_NAME === undefined)
  {
      throw new mongoDB.MongoInvalidArgumentError("Please provide all the necessary configuration for connecting to the database.");
  }

  const client: mongoDB.MongoClient = new mongoDB.MongoClient(process.env.DB_CONN_STRING);
            
  await client.connect();
        
  const db: mongoDB.Db = client.db(process.env.DB_NAME);
   
  const playersCollection: mongoDB.Collection<NflPlayer> = db.collection<NflPlayer>(process.env.PLAYERS_COLLECTION_NAME);
 
  collections.players = playersCollection;
       
  console.log(`Successfully connected to database: ${db.databaseName} and collection: ${playersCollection.collectionName}`);
}

export const get = (ids: string[]): NflPlayer[] => {
   let query = { sleeper_id: { $in: ids } };
   return collections.players!.find(query).toArray() as unknown as NflPlayer[];
} 

export const post = async (players: NflPlayer[]) => {
  await collections.players!.insertMany(players);
}