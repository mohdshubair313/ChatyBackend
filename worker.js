import dotenv from 'dotenv';
dotenv.config();
import { Worker } from 'bullmq';
import { CohereEmbeddings } from "@langchain/cohere";
import { QdrantVectorStore } from "@langchain/qdrant";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { CharacterTextSplitter } from "@langchain/textsplitters";
import { Blob } from 'node:buffer';


const worker = new Worker('file-upload-Queue', async job => {
    try {
        const data = JSON.parse(job.data);
        console.log(data)
        console.log(`\n📄 Processing: ${data.filename}`);

        const response = await axios.get(data.path)
        await response.buffer() // get the pdf content as a buffer

        // Load PDF
        const blob = new Blob([response], {type: 'application/pdf'})
        const loader = new PDFLoader(blob);
        const docs = await loader.load();
        console.log(`Loaded ${docs.length} page(s)`);

        // Split into chunks
        const textSplitter = new CharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });
        const splitDocs = await textSplitter.splitDocuments(docs);
        console.log(`Created ${splitDocs.length} chunks`);

        // Initialize embeddings
        const embeddings = new CohereEmbeddings({
            apiKey: process.env.COHERE_API_KEY,
            model: "embed-english-v3.0",
            batchSize: 48,
        });

        // Store in Qdrant
        console.log(`Storing in Qdrant...`);

        try {
            const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
                url: process.env.QDRANT_URL,
                collectionName: "pdf-chat-collection",
            });

            await vectorStore.addDocuments(splitDocs);
        } catch (error) {
            vectorStore = await QdrantVectorStore.fromDocuments(
                splitDocs,
                embeddings,
                {
                    url: process.env.QDRANT_URL,
                    collectionName: "pdf-chat-collection",
                }
            );
        }

        console.log(`Done! ${splitDocs.length} chunks stored\n`);

        return {
            success: true,
            filename: data.filename,
            chunks: splitDocs.length
        };

    } catch (error) {
        console.error(`Error: ${error.message}`);
        throw error;
    }
}, {
    concurrency: 5, // Fixed: was 100
    connection: {
        host: 'localhost',
        port: 6379 // Fixed: was string '6379'
    }
});

worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
    console.error(` Job ${job?.id} failed: ${err.message}`);
});

console.log('you will see this first ... -> Worker ready\n');
