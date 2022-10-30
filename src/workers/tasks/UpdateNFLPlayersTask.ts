import { Task } from "./Task";
import axios from 'axios';
import { GetNflPlayersResponse } from "../../models/GetNflPlayersResponse";

export class UpdateNFLPlayersTask extends Task {
    public async run() {
        try {
            const { data, status } = await axios.get<GetNflPlayersResponse>(
              'https://reqres.in/api/users',
              {
                headers: {
                  Accept: 'application/json',
                },
              },
            );
        
            console.log(JSON.stringify(data, null, 4));
        
            // 👇️ "response status is: 200"
            console.log('response status is: ', status);

          } catch (error) {
            if (axios.isAxiosError(error)) {
              console.log('error message: ', error.message);
            } else {
              console.log('unexpected error: ', error);
            }
          }
    }
}