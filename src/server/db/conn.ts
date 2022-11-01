import * as mongoDB from "mongodb";
import * as dotenv from "dotenv";

let db: mongoDB.Db;

export const connect = async () => {
  dotenv.config();
 
  if(process.env.DB_CONN_STRING === undefined
    || process.env.DB_NAME === undefined
    || process.env.PLAYERS_COLLECTION_NAME === undefined)
  {
      throw new mongoDB.MongoInvalidArgumentError("Please provide all the necessary configuration for connecting to the database.");
  }

  const client: mongoDB.MongoClient = new mongoDB.MongoClient(process.env.DB_CONN_STRING);
            
  await client.connect();
        
  db = client.db(process.env.DB_NAME);
       
  console.log(`Successfully connected to database: ${db.databaseName}`);
}

export const getDb = (): mongoDB.Db => {
    return db;
}