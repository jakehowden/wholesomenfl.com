import express from "express";
import cors from "cors"
import dotenv from "dotenv";
import { connect } from "./db/conn"

const app = express();
dotenv.config();

const port = process.env.PORT || 27017;

app.use(cors());
app.use(express.json());
app.use(require("./routes/players"));
 
app.listen(port, () => {
  connect();

  console.log(`Server is running on port: ${port}`);
});