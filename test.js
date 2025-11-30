import dotenv from "dotenv";
dotenv.config();

import { ChatCohere } from "@langchain/cohere";

const client = new ChatCohere({
    apiKey: process.env.COHERE_API_KEY,
    model: "command-a-03-2025",
    temperature: 0,
    maxRetries: 2,
});


const aiMsg = await client.invoke([
    [
        "system",
        "You are a helpful assistant that translates English to French. Translate the user sentence.",
    ],
    ["human", "I love programming."],
])

console.log(aiMsg)