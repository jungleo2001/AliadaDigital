// server.js — CommonJS, compatível com Assistants API v2
const express = require("express");
const multer = require("multer");
const dotenv = require("dotenv");
const fs = require("fs");

// Node 18+ já tem fetch e FormData nativos
const fetch = global.fetch;
const { FormData } = global;

// Carrega variáveis do .env
dotenv.config();

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || "whisper-1";

// -----------------------------------------
// 🧠 ROTA: Chat conectado ao Assistant API v2
// -----------------------------------------
app.post("/api/chat", async (req, res) => {
  try {
    const { history } = req.body;

    if (!ASSISTANT_ID) {
      return res.status(500).json({ error: "ASSISTANT_ID não configurado no .env" });
    }

    console.log(`🤖 Enviando mensagem para Assistant ${ASSISTANT_ID}...`);

    // 1️⃣ Cria um thread (conversa)
    const createThread = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2" // Obrigatório
      },
      body: JSON.stringify({
messages: (history || [])
  .filter(m => m.role === "user" || m.role === "assistant") // ignora system
  .map(h => ({
    role: h.role,
    content: h.content
  }))

      })
    });

    const threadData = await createThread.json();
    if (!createThread.ok) {
      console.error("❌ Erro ao criar thread:", threadData);
      return res.status(createThread.status).json(threadData);
    }

    const threadId = threadData.id;
    console.log("🧵 Thread criada:", threadId);

    // 2️⃣ Cria o run (executa o Assistant)
    const createRun = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2" // Obrigatório
      },
      body: JSON.stringify({
        assistant_id: ASSISTANT_ID
      })
    });

    const runData = await createRun.json();
    if (!createRun.ok) {
      console.error("❌ Erro ao criar run:", runData);
      return res.status(createRun.status).json(runData);
    }

    const runId = runData.id;
    console.log("🏃 Run iniciada:", runId);

    // 3️⃣ Aguarda o run finalizar
    let status = "in_progress";
    while (status === "in_progress" || status === "queued") {
      await new Promise(r => setTimeout(r, 1000)); // espera 1 segundo
      const checkRun = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2"
        }
      });
      const runCheckData = await checkRun.json();
      status = runCheckData.status;
      console.log("⏳ Status:", status);
    }

    // 4️⃣ Busca mensagens finais do thread
    const messagesRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "assistants=v2"
      }
    });

    const messagesData = await messagesRes.json();
    let outputText = "(sem resposta)";

    if (messagesData.data && messagesData.data.length > 0) {
      const last = messagesData.data[0];
      const textBlock = last.content.find(c => c.type === "output_text" || c.type === "text");
      outputText = textBlock?.text?.value || textBlock?.text || outputText;
    }

// 🧹 Limpa referências de fonte tipo [4:0†source] antes de enviar
outputText = outputText.replace(/\[\d+:\d+†[^\]]+\]/g, "").trim();
outputText = outputText.replace(/\s+/g, " ").trim(); // remove espaços duplos

console.log("💬 Resposta do assistant (limpa):", outputText);
res.json({ reply: outputText });
  } catch (err) {
    console.error("❌ Server error (assistant run):", err);
    res.status(500).json({ error: String(err) });
  }
});

// -----------------------------------------
// 🎧 ROTA: Transcrição de áudio (Whisper)
// -----------------------------------------
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  const filePath = req.file?.path;
  if (!filePath) return res.status(400).json({ error: "Arquivo de áudio não enviado" });

  try {
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), req.file.originalname);
    form.append("model", TRANSCRIBE_MODEL);

    console.log("🎙️ Enviando áudio para transcrição...");

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
      body: form
    });

    if (!r.ok) {
      const errTxt = await r.text();
      console.error("❌ Erro na transcrição:", errTxt);
      return res.status(r.status).json({ error: errTxt });
    }

    const data = await r.json();
    res.json({ text: data.text });
  } catch (err) {
    console.error("❌ Server error (transcribe):", err);
    res.status(500).json({ error: String(err) });
  } finally {
    fs.unlink(filePath, () => {}); // limpa arquivo temporário
  }
});

// -----------------------------------------
// 🚀 Inicializa servidor
// -----------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor em http://localhost:${PORT}`));
