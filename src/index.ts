/**
 * LLM Chat Application - Enhanced Backend
 *
 * Handles text chat, file uploads, and vision model requests.
 * Supports streaming responses via SSE.
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Default text model
const TEXT_MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";
// Vision model for image + text
const VISION_MODEL_ID = "@cf/llava-hf/llava-1.5-7b-hf";

// Default system prompt
const SYSTEM_PROMPT =
	"You are a helpful, friendly assistant. Provide concise and accurate responses. When given files or images, analyze and describe them thoroughly.";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// CORS headers for development
		const corsHeaders = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		};

		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		// Handle static assets (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API Routes
		if (url.pathname === "/api/chat") {
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}
			return new Response("Method not allowed", { status: 405 });
		}

		if (url.pathname === "/api/chat-with-file") {
			if (request.method === "POST") {
				return handleChatWithFileRequest(request, env);
			}
			return new Response("Method not allowed", { status: 405 });
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Handles plain text chat requests (streaming)
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		const stream = await env.AI.run(
			TEXT_MODEL_ID,
			{
				messages,
				max_tokens: 2048,
				stream: true,
			},
		);

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
				"Access-Control-Allow-Origin": "*",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}

/**
 * Handles chat requests that include a file/image attachment.
 * For images: uses vision model (LLaVA).
 * For text files (PDF text, TXT, CSV, JSON, DOCX text): injects content as context.
 */
async function handleChatWithFileRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const formData = await request.formData();
		const messagesRaw = formData.get("messages") as string;
		const file = formData.get("file") as File | null;
		const fileType = (formData.get("fileType") as string) || "";
		const fileText = (formData.get("fileText") as string) || "";

		const messages: ChatMessage[] = JSON.parse(messagesRaw || "[]");

		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		// If an image file is provided, use the vision model
		if (file && isImageType(fileType)) {
			const imageBuffer = await file.arrayBuffer();
			const imageArray = Array.from(new Uint8Array(imageBuffer));

			// Get the latest user message as the prompt
			const userMessages = messages.filter((m) => m.role === "user");
			const prompt =
				userMessages.length > 0
					? userMessages[userMessages.length - 1].content
					: "Describe this image in detail.";

			const visionResult = await env.AI.run(VISION_MODEL_ID, {
				image: imageArray,
				prompt: prompt,
				max_tokens: 2048,
			});

			// Return as SSE stream format for consistency
			const responseText =
				typeof visionResult === "object" && "description" in visionResult
					? (visionResult as { description: string }).description
					: JSON.stringify(visionResult);

			const sseData = `data: ${JSON.stringify({ response: responseText })}\n\ndata: [DONE]\n\n`;

			return new Response(sseData, {
				headers: {
					"content-type": "text/event-stream; charset=utf-8",
					"cache-control": "no-cache",
					connection: "keep-alive",
					"Access-Control-Allow-Origin": "*",
				},
			});
		}

		// For text-based files: inject extracted text as context in the messages
		if (fileText) {
			// Find the last user message and prepend file content
			const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
			if (lastUserIdx !== -1) {
				messages[lastUserIdx] = {
					...messages[lastUserIdx],
					content: `[File content attached]\n\`\`\`\n${fileText.slice(0, 8000)}\n\`\`\`\n\nUser question: ${messages[lastUserIdx].content}`,
				};
			}
		}

		const stream = await env.AI.run(
			TEXT_MODEL_ID,
			{
				messages,
				max_tokens: 2048,
				stream: true,
			},
		);

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
				"Access-Control-Allow-Origin": "*",
			},
		});
	} catch (error) {
		console.error("Error processing file chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}

function isImageType(fileType: string): boolean {
	return (
		fileType.startsWith("image/") ||
		["jpg", "jpeg", "png", "gif", "webp"].some((ext) =>
			fileType.toLowerCase().includes(ext),
		)
	);
}
