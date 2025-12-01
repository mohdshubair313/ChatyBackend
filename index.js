import express from "express";
import cors from "cors"
import multer from 'multer'
import { Queue } from 'bullmq'
import dotenv from 'dotenv';
import { CohereEmbeddings } from "@langchain/cohere";
import { QdrantVectorStore } from "@langchain/qdrant";
import { ChatCohere } from "@langchain/cohere";
import storage from './pdfUploader.js'
import Redis from "ioredis"

dotenv.config();

// ---------- Basic checks ----------
if (!process.env.COHERE_API_KEY) {
  console.warn("⚠️ COHERE_API_KEY is not set");
}
if (!process.env.QDRANT_URL || !process.env.API_KEY) {
  console.warn("⚠️ QDRANT_URL or API_KEY is not set for Qdrant");
}

const uploads = multer({ storage: storage })

const client = new ChatCohere({
  apiKey: process.env.COHERE_API_KEY,
  model: "command-a-03-2025",
  temperature: 0,
  maxRetries: 2,
});

const Redisclient = new Redis(process.env.REDIS_URL);

Redisclient.on("connect", () => {
  console.log("✅ Redis connected");
})
Redisclient.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
})

async function usage() {
  await Redisclient.set('foo', 'bar');
  let x = await Redisclient.get("foo");
  console.log(x);
}

usage();

const queue = new Queue('file-upload-Queue', {
  connection: Redisclient,
});

const embeddings = new CohereEmbeddings({
  apiKey: process.env.COHERE_API_KEY,
  model: "embed-english-v3.0",
  batchSize: 48,
  checkCompatibility: false,
});

// Initialize Vector Store safely
let vectorStore;
try {
  vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
    url: process.env.QDRANT_URL,
    apiKey: process.env.API_KEY,
    collectionName: "pdf-chat-collection",
  });
  console.log("✅ Vector Store connected");
} catch (error) {
  console.error("❌ Failed to connect to Vector Store:", error.message);
}

const app = express()
app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
  return res.json({ message: "Server is running 🚀" })
})

app.post('/uploads/pdf', uploads.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" })
    }

    console.log(`📂 File received: ${req.file.originalname}`);

    await queue.add('file-ready...', JSON.stringify({
      path: req.file.path || req.file.location,
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    }))

    return res.json({
      message: "PDF successfully uploaded and queued for processing",
      fileInfo: {
        originalName: req.file.originalname,
        savedAs: req.file.filename,
        path: req.file.path || req.file.location,
      }
    });
  } catch (error) {
    console.error("Upload Error:", error);
    return res.status(500).json({ error: "Internal Server Error during upload" });
  }
})

app.get('/chat', async (req, res) => {
  try {
    const userQuery = req.query.message
    if (!userQuery) {
      return res.status(400).json({ error: "Message query parameter is required" });
    }

    if (!vectorStore) {
      return res.status(503).json({ error: "Vector Store not initialized" });
    }

    const retriever = vectorStore.asRetriever({
      k: 5, // Increased context window slightly
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

    console.log(`🤖 AI Response: ${ragResponse.content.substring(0, 50)}...`);

    res.json({
      message: ragResponse.content,
      docs: result
    })
  } catch (error) {
    console.error("Chat Error:", error);
    res.status(500).json({ error: "Internal Server Error during chat processing" });
  }
})

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
})