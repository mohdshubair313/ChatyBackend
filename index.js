import express from "express";
import cors from "cors"
import multer from 'multer'
import {Queue} from 'bullmq'
import dotenv from 'dotenv';
import { CohereEmbeddings } from "@langchain/cohere";
import { QdrantVectorStore } from "@langchain/qdrant";
import { ChatCohere } from "@langchain/cohere";
import { HumanMessage } from "@langchain/core/messages";

dotenv.config(); 

const client = new ChatCohere({
  apiKey: process.env.COHERE_API_KEY,
  model: "command-a-03-2025",
  temperature: 0,
  maxRetries: 2,
});

const queue = new Queue('file-upload-Queue', {
    connection: {
        host: 'localhost',
        port: 6379
    },
});

const embeddings = new CohereEmbeddings({
  apiKey: process.env.COHERE_API_KEY,
  model: "embed-english-v3.0",
  batchSize: 48,
});

const vectorStore = await QdrantVectorStore.fromExistingCollection( embeddings,{
  url: process.env.QDRANT_URL,
  collectionName: "pdf-chat-collection",
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null,`${uniqueSuffix}-${file.originalname}`)
  }
})

const uploads = multer({ storage: storage })

const app  = express()
app.use(cors())
app.use(express.json())


app.get('/', (req, res) => {
    return res.json({message: "all good going and this is res.json(message)"})
})

app.post('/uploads/pdf', uploads.single('file'), async (req,res) => {

  console.log(req.file)

  if (!req.file) {
    return res.status(400).json({error: "yaha par file nahi aa rahi hai bhai .. check index.js file again"})
  }

    await queue.add('file-ready...', JSON.stringify({
      // add the full pdf path which is best to send in workers and then chunk in workers.js
        path: req.file.path,
        filename: req.file.originalname,
        destination: req.file.destination,
        size: req.file.size,
        mimetype: req.file.mimetype,
    }))
    
    return res.json({
        message: "PDF successfully uploaded and queued for processing",
        fileInfo: {
            originalName: req.file.originalname,
            savedAs: req.file.filename,
            path: req.file.path
        }
    });
    
})

app.get('/chat', async (req, res) => {
  const userQuery = req.query.message
  
  const retriever = vectorStore.asRetriever({
    k: 2,
  });
  const result = await retriever.invoke(userQuery);
  const context = result.map(doc => doc.pageContent).join('\n\n');
  
  const SYSTEM_PROMPT = `You are a helpful and knowledgeable AI assistant specializing in analyzing and answering questions about PDF documents. Your goal is to provide accurate, clear, and conversational responses based on the uploaded document's content.

## Your Core Responsibilities:
- Carefully analyze the provided context from the PDF document
- Answer questions accurately using ONLY the information present in the given context
- If the answer isn't in the provided context, honestly say "I don't have that information in the uploaded document"
- Provide direct, concise answers while being friendly and conversational
- Use natural language and avoid overly technical jargon unless necessary

## Response Guidelines:
1. **Be Precise**: Quote or reference specific parts of the document when answering
2. **Be Helpful**: If the user's question is unclear, ask for clarification
3. **Be Honest**: Never make up information or hallucinate facts not in the document
4. **Be Conversational**: Write in a friendly, natural tone like talking to a colleague
5. **Be Structured**: Use bullet points, numbered lists, or paragraphs as appropriate

## Context Format:
You will receive relevant excerpts from the PDF document. Base your answers ONLY on this context.

Context: ${context}

User Question: ${userQuery}

## Your Response:
Provide a clear, accurate answer based on the context above. If you cannot find the answer in the context, politely state that the information is not available in the uploaded document.`;

const ragResponse = await client.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userQuery }
]);

console.log(ragResponse.content);

res.json({
  message: ragResponse.content,
  docs: result
})

})

app.listen(8080, () => {
    console.log("hey there")
})