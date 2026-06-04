import os
from groq import AsyncGroq
from typing import List, Dict, AsyncGenerator
from dotenv import load_dotenv

# Ensure environment variables are loaded
load_dotenv()

class LLMService:
    def __init__(self):
        self.api_key = os.getenv("GROQ_API_KEY")
        if not self.api_key:
            raise ValueError("GROQ_API_KEY environment variable not set")
        
        self.client = AsyncGroq(api_key=self.api_key)
        self.model = "llama-3.3-70b-versatile" # Powerful and free on Groq

    async def generate_response(self, prompt: str, history: List[Dict[str, str]] = None) -> AsyncGenerator[str, None]:
        """
        Generates a streaming response from Groq based on the prompt and history.
        """
        messages = []
        if history:
            # Groq uses standard OpenAI-like message format
            messages.extend(history)
        
        # Add the current prompt as a user message if it's not already in history (it usually isn't)
        # But wait, our interview flow handles history construction including the current prompt.
        # Let's inspect how it's called.
        # In interview_flow.py: generate_response(full_prompt, history=history)
        # full_prompt contains system prompt + user input. 
        # But history contains PAST turns.
        # We should structure this properly as messages.
        
        # Actually, let's just append the current prompt if needed or treat it as the last user message.
        # The caller passes `full_prompt` which is a string. We should try to use system message if possible.
        
        # Simpler approach: treat prompt as the latest user message or system message?
        messages.append({"role": "user", "content": prompt})

        stream = await self.client.chat.completions.create(
            messages=messages,
            model=self.model,
            stream=True,
            temperature=0.4
        )
        
        async for chunk in stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content

    async def generate_json_response(self, prompt: str) -> str:
        """
        Generates a JSON response (non-streaming).
        """
        completion = await self.client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model=self.model,
            response_format={"type": "json_object"}
        )
        return completion.choices[0].message.content

    async def evaluate_answer_groq(self, question: str, answer: str) -> Dict[str, float]:
        from agents.interview_agent.prompts import INTERVIEW_ANSWER_EVALUATION_PROMPT
        import json
        
        prompt = INTERVIEW_ANSWER_EVALUATION_PROMPT.format(question=question, answer=answer)
        try:
            res_str = await self.generate_json_response(prompt)
            result = json.loads(res_str)
            return {
                "technical_accuracy": float(result.get("technical_accuracy", 0)),
                "depth_of_explanation": float(result.get("depth_of_explanation", 0)),
                "clarity": float(result.get("clarity", 0)),
                "confidence_level": float(result.get("confidence_level", 0))
            }
        except Exception as e:
            print(f"Error evaluating answer: {e}")
            return {
                "technical_accuracy": 0,
                "depth_of_explanation": 0,
                "clarity": 0,
                "confidence_level": 0
            }

