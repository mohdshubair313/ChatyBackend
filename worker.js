import dotenv from 'dotenv';
dotenv.config();

import { Worker } from 'bullmq';
import { CohereEmbeddings } from "@langchain/cohere";
import { QdrantVectorStore } from "@langchain/qdrant";
import { WebPDFLoader } from "@langchain/community/document_loaders/web/pdf";
import { CharacterTextSplitter } from "@langchain/textsplitters";
import axios from 'axios';
import Redis from "ioredis"

const Redisclient = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
await Redisclient.set('foo', 'bar');
let x = await Redisclient.get("foo");
console.log(x);

const worker = new Worker('file-upload-Queue', async job => {
  try {
    const data = JSON.parse(job.data);
    console.log(`📄 Processing: ${data.path}`);

    // Download PDF from Cloudinary
    const response = await axios.get(data.path, {
      responseType: 'arraybuffer',
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch PDF: ${response.status}`);
    }

    // Convert Buffer to Blob for WebPDFLoader
    const pdfBlob = new Blob([response.data], { type: 'application/pdf' });

    // Load PDF using WebPDFLoader (uses pdfjs-dist)
    const loader = new WebPDFLoader(pdfBlob);
    const docs = await loader.load();

    console.log(`Loaded ${docs.length} pages`);

    // Add metadata to documents
    docs.forEach(doc => {
      doc.metadata.source = data.path;
      doc.metadata.filename = data.filename;
      doc.metadata.userId = data.userId;
    });

    if (docs.length > 0) {
      console.log(`🔍 Worker - Sample Doc Content: ${docs[0].pageContent.substring(0, 100)}...`);
      console.log(`🔍 Worker - Sample Doc Metadata:`, docs[0].metadata);
    }

    // Split into chunks
    const textSplitter = new CharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const splitDocs = await textSplitter.splitDocuments(docs);
    console.log(`Created ${splitDocs.length} chunks`);

    // Embeddings
    const embeddings = new CohereEmbeddings({
      apiKey: process.env.COHERE_API_KEY,
      model: "embed-english-v3.0",
      batchSize: 48,
    });

    // Vector Store
    const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
      url: process.env.QDRANT_URL,
      apiKey: process.env.API_KEY,
      collectionName: "pdf-chat-collection",
      timeout: 60000,
    });

    await vectorStore.addDocuments(splitDocs);

    console.log(`Done: ${splitDocs.length} chunks stored`);
    return { success: true, chunks: splitDocs.length };
  } catch (error) {
    console.error(`Error: ${error.message}`);
    throw error;
  }
}, {
  concurrency: 5,
  connection: Redisclient
});

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(` Job ${job?.id} failed: ${err.message}`);
});

console.log('you will see this first ... -> Worker ready\n');