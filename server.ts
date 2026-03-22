import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

// Initialize Gemini for the vision step (using the platform's key)
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API route for caption generation using OpenRouter
  app.post("/api/generate-captions", async (req, res) => {
    const { imageData, options } = req.body;
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured in the environment." });
    }

    try {
      // Step 1: Get image description using a vision model via OpenRouter
      // We use gpt-4o-mini as it's very reliable for vision tasks on OpenRouter
      let description = "";
      try {
        const visionResponse = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
          model: "openai/gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Describe this image in detail so I can generate captions for it. Focus on the subject, mood, and key elements." },
                { type: "image_url", image_url: { url: imageData } }
              ]
            }
          ]
        }, {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://ai.studio",
            "X-Title": "AI Caption Crafter"
          }
        });
        
        if (visionResponse.data.choices && visionResponse.data.choices.length > 0) {
          description = visionResponse.data.choices[0].message.content;
        } else {
          throw new Error("OpenRouter vision response was empty.");
        }
      } catch (visionError: any) {
        console.error("OpenRouter Vision Error:", visionError.response?.data || visionError.message);
        // Fallback to a generic description if vision fails completely
        description = "A social media image featuring interesting subjects and a vibrant atmosphere.";
      }

      console.log("Image Description generated via OpenRouter:", description.substring(0, 100) + "...");

      // Step 2: Generate creative captions using the user's requested model via OpenRouter
      const captionResponse = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
        model: "nvidia/nemotron-3-super-120b-a12b:free",
        messages: [
          {
            role: "system",
            content: `You are a world-class social media strategist and SEO expert. 
            Your goal is to generate exactly 5 high-performing captions optimized for the ${options.platform} algorithm, TikTok, and Facebook.
            
            Optimization Rules:
            1. Hook: A powerful scroll-stopping first line.
            2. Body: Engaging storytelling or value-driven content.
            3. CTA: A clear Call to Action.
            4. SEO: Naturally integrate relevant keywords.
            5. Hashtags: A mix of 5-10 broad and niche hashtags.
            
            IMPORTANT: You MUST return a JSON object with a "captions" key containing an array of exactly 5 objects.
            Each object MUST have these exact keys: "hook", "body", "cta", "hashtags" (array of strings).
            Do not include any other text or markdown formatting outside the JSON.`
          },
          {
            role: "user",
            content: `Image Description: ${description}\n\nTone: ${options.tone}\nLanguage: ${options.language}\nAdditional Context: ${options.additionalContext || "None"}\n\nGenerate exactly 5 algorithm-optimized captions in JSON format.`
          }
        ],
        response_format: { type: "json_object" }
      }, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://ai.studio",
          "X-Title": "AI Caption Crafter"
        }
      });

      let captionsData;
      try {
        const content = captionResponse.data.choices[0].message.content;
        const parsed = JSON.parse(content);
        
        // Robust extraction
        if (Array.isArray(parsed)) {
          captionsData = parsed;
        } else if (parsed.captions && Array.isArray(parsed.captions)) {
          captionsData = parsed.captions;
        } else if (parsed.results && Array.isArray(parsed.results)) {
          captionsData = parsed.results;
        } else {
          // If it's just one object or something else, wrap it
          captionsData = [parsed];
        }

        // Ensure we only have 5
        captionsData = captionsData.slice(0, 5);

        // Normalize keys if the AI hallucinated different ones
        captionsData = captionsData.map((c: any) => ({
          hook: c.hook || c.headline || c.title || c.first_line || "Untitled Caption",
          body: c.body || c.content || c.description || c.text || "",
          cta: c.cta || c.call_to_action || c.engagement || "",
          hashtags: Array.isArray(c.hashtags) ? c.hashtags : (c.tags || [])
        }));

      } catch (e) {
        console.error("JSON Parse Error:", e);
        return res.json({ text: captionResponse.data.choices[0].message.content, isRaw: true });
      }

      res.json({ captions: captionsData, isRaw: false });
    } catch (error: any) {
      const errorDetail = error.response?.data || error.message;
      console.error("OpenRouter Final Error:", JSON.stringify(errorDetail, null, 2));
      res.status(500).json({ error: `Generation Error: ${typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail}` });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
