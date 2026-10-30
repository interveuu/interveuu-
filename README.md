<div align="center">

<img src="assets/logo.png" alt="Interveuu logo" width="110" />

# Interveuu

**AI-powered mock interviews with adaptive questioning and actionable feedback.**

Practice realistic interviews, get evaluated in real time, and track your improvement, so you walk into the real thing prepared.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/interveuu/interveuu-?style=flat-square&color=yellow)](https://github.com/interveuu/interveuu-/stargazers)
[![Issues](https://img.shields.io/github/issues/interveuu/interveuu-?style=flat-square)](https://github.com/interveuu/interveuu-/issues)
[![Last Commit](https://img.shields.io/github/last-commit/interveuu/interveuu-?style=flat-square)](https://github.com/interveuu/interveuu-/commits/main)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](#contributing)

[Live Demo](#) &nbsp;•&nbsp; [Documentation](#architecture) &nbsp;•&nbsp; [Report a Bug](https://github.com/interveuu/interveuu-/issues) &nbsp;•&nbsp; [Request a Feature](https://github.com/interveuu/interveuu-/issues)

<br />

<img src="assets/demo.gif" alt="Interveuu product demo" width="820" />

</div>

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Most interview-prep tools give you a static list of questions. **Interveuu** simulates the actual experience: an AI interviewer asks questions, listens to your answers, probes where you are vague, and delivers a structured evaluation when the session ends.

It combines **Groq** for low-latency conversational responses with **Google Gemini** for deeper analysis and feedback generation, giving candidates a fast, natural interview flow and a thoughtful post-interview report.

## Key Features

| Feature | Description |
|---|---|
| **Conversational interviews** | Natural back-and-forth with dynamic, context-aware follow-up questions |
| **Voice interviews** | Answer out loud and get a spoken, real-time interview experience |
| **Role-based sessions** | Questions tailored to the target role, level, and interview type |
| **Resume-aware questions** | Questions generated from your own experience and projects |
| **Instant feedback & scoring** | Evaluation of clarity, depth, structure, and relevance |
| **Video & delivery analysis** | Insight into presentation and delivery, beyond just content |
| **Session history** | Review past interviews and track improvement over time |
| **Adaptive difficulty** | Question difficulty adjusts based on your performance |

## How It Works

1. **Configure**: select a role, experience level, and interview type (optionally upload a resume).
2. **Interview**: the AI interviewer asks questions and adapts to each answer in real time.
3. **Evaluate**: responses are analyzed for relevance, structure, depth, and communication.
4. **Review**: receive a detailed report with strengths, gaps, and concrete next steps.

## Architecture

Interveuu follows a layered architecture that separates the user interface, application logic, AI orchestration, and persistence. Latency-sensitive interview turns and heavier evaluation work are routed to different models.

```mermaid
flowchart TB
    subgraph Client["Client Layer"]
        UI["Web App<br/>(Interview UI, Dashboard)"]
        MEDIA["Audio / Video Capture"]
    end

    subgraph Server["Application Layer"]
        API["REST API / Route Handlers"]
        AUTH["Authentication & Session Management"]
        ORCH["Interview Orchestrator<br/>(state, prompts, difficulty engine)"]
    end

    subgraph AI["AI Layer"]
        GROQ["Groq<br/>Real-time questions & follow-ups"]
        GEMINI["Google Gemini<br/>Evaluation, scoring & feedback"]
    end

    subgraph Data["Data Layer"]
        DB[("Database<br/>Users, Sessions, Transcripts, Reports")]
    end

    UI --> API
    MEDIA --> API
    API --> AUTH
    API --> ORCH
    ORCH -->|"low-latency turns"| GROQ
    ORCH -->|"deep analysis"| GEMINI
    ORCH --> DB
    AUTH --> DB
```

### Interview Lifecycle

```mermaid
sequenceDiagram
    participant U as Candidate
    participant A as API
    participant O as Orchestrator
    participant G as Groq
    participant M as Gemini
    participant D as Database

    U->>A: Start session (role, level, resume)
    A->>O: Initialize interview context
    O->>D: Create session record
    loop Each question
        O->>G: Generate question / follow-up
        G-->>U: Interviewer response
        U->>A: Submit answer (text / voice)
        A->>D: Store transcript turn
    end
    U->>A: End interview
    A->>O: Request evaluation
    O->>M: Analyze full transcript
    M-->>O: Scores, strengths, gaps
    O->>D: Persist report
    A-->>U: Feedback report
```

### Design Decisions

- **Two-model strategy**: Groq handles the conversational loop where response time defines the experience, while Gemini handles the post-session analysis where reasoning quality matters more than speed.
- **Stateful orchestration**: the orchestrator owns interview state (question history, difficulty level, context), keeping the client thin and the AI calls stateless.
- **Persistent transcripts**: every turn is stored, enabling session history, progress tracking, and re-evaluation.
- **Server-side secrets**: all AI provider keys stay on the server and are never exposed to the client.

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js, React, Tailwind CSS |
| **Backend** | Node.js, Next.js API Routes |
| **Conversational AI** | [Groq API](https://console.groq.com) |
| **Analysis AI** | [Google Gemini API](https://aistudio.google.com) |
| **Database** | PostgreSQL |
| **Deployment** | Vercel |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- A [Groq API key](https://console.groq.com/keys)
- A [Gemini API key](https://aistudio.google.com/app/apikey)
- A database connection string (PostgreSQL recommended)

### Installation

```bash
# Clone the repository
git clone https://github.com/interveuu/interveuu-.git
cd interveuu-

# Install dependencies
npm install

# Create your environment file
cp .env.example .env
```

### Environment Variables

Configure the following in your `.env` file:

| Variable | Description | Required |
|---|---|:---:|
| `GROQ_API_KEY` | API key for Groq, used for real-time interview conversation | Yes |
| `GEMINI_API_KEY` | API key for Google Gemini, used for evaluation and feedback | Yes |
| `DATABASE_URL` | Database connection string | Yes |

```env
GROQ_API_KEY=your_groq_api_key
GEMINI_API_KEY=your_gemini_api_key
DATABASE_URL=postgresql://user:password@localhost:5432/interveuu
```

> **Security note:** never commit your `.env` file. It is already listed in `.gitignore`.

### Run Locally

```bash
npm run dev
```

The app will be available at **http://localhost:3000**.

### Production Build

```bash
npm run build
npm start
```

## Usage

1. Sign in or start a new session.
2. Choose your target role, experience level, and interview type.
3. Begin the interview and respond by voice or text.
4. End the session to receive your scored feedback report.
5. Revisit past sessions from your dashboard to track progress.

<details>
<summary><b>Example feedback report</b></summary>

<br />

```text
Overall Score: 8.2 / 10

Strengths
  - Clear, structured answers following the STAR method
  - Strong technical vocabulary and confident delivery

Areas for Improvement
  - Quantify the impact of your projects with metrics
  - Keep answers concise; aim for 1 to 2 minutes each

Recommended Next Steps
  - Practice three more behavioral questions on conflict resolution
  - Revisit system design fundamentals
```

</details>

## Project Structure

```text
interveuu-/
├── src/
│   ├── app/              # Routes, pages, and API handlers
│   ├── components/       # Reusable UI components
│   ├── lib/
│   │   ├── ai/           # Groq and Gemini clients, prompt templates
│   │   ├── interview/    # Orchestrator, difficulty engine, scoring
│   │   └── db/           # Database client and queries
│   └── styles/           # Global styles
├── public/               # Static assets
├── assets/               # README images
├── .env.example          # Environment variable template
├── LICENSE
└── README.md
```

## Roadmap

- [x] Text-based AI interviews
- [x] Feedback and scoring
- [x] Voice interviews
- [x] Resume-aware questions
- [x] Video / body-language analysis
- [ ] Multi-language support
- [ ] Company-specific interview tracks

Have a suggestion? [Open an issue](https://github.com/interveuu/interveuu-/issues) to start the conversation.

## Contributing

Contributions are welcome and appreciated.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push to your branch: `git push origin feature/your-feature`
5. Open a Pull Request

Please follow [Conventional Commits](https://www.conventionalcommits.org/) and keep pull requests focused and well described.

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

## Acknowledgements

- [Groq](https://groq.com) for ultra-low-latency inference
- [Google Gemini](https://ai.google.dev) for advanced reasoning and analysis
- [Shields.io](https://shields.io) for badges

---

<div align="center">

If Interveuu helped you, consider giving it a star.

Built by the [Interveuu](https://github.com/interveuu) team

</div>
