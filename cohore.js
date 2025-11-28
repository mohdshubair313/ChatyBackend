import "dotenv/config";
import { CohereEmbeddings } from "@langchain/cohere";

const embeddings = new CohereEmbeddings({
    apiKey: process.env.COHERE_API_KEY,
    model: "embed-english-v3.0",
    batchSize: 48,
});

const text = "Hello, how are you?";
const singleVector = await embeddings.embedQuery(text);
console.log(singleVector.slice(0, 100));