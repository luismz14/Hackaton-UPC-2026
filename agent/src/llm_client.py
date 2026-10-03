import json
import os
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class LLMClient(Protocol):
    provider: str
    model: str

    def generate(self, messages: list[dict[str, str]]) -> str:
        ...

    def rewrite(self, source_text: str) -> str:
        ...


class MockLLMClient:
    provider = "mock"
    model = "mock-grounded-maintenance-copilot"

    def generate(self, messages: list[dict[str, str]]) -> str:
        """Generate deterministic text from the supplied LLM context.

        @param messages: Chat messages containing serialized context in the user message.
        @return: Plain-text maintenance explanation for tests and offline use.
        """
        context = extract_context(messages)

        if context["analysis_summary"]["decision_count"] == 0:
            return "No immediate maintenance action is required based on the provided analysis. The available data does not show active issues."

        lines = [
            f"Run {context['run_id']} has overall priority {context['analysis_summary']['highest_priority']}.",
            f"The agent detected {context['analysis_summary']['decision_count']} issue(s).",
            "",
            "Recommended plan:",
        ]

        for decision in context["decisions"]:
            selected_plan = decision["selected_plan"]
            forecast = decision["forecast_without_intervention"]

            lines.extend(
                [
                    f"- {decision['component_id']}: {selected_plan['actions_text']}.",
                    f"  Reason: without intervention, projected status is {forecast['predicted_status']} with risk score {forecast['risk_score']}.",
                    f"  Expected result: projected status becomes {selected_plan['projected_status']} with health index {selected_plan['projected_health_index']} and risk score {selected_plan['risk_score']}.",
                    "  Evidence:",
                ]
            )

            for evidence in decision["evidence"][:3]:
                lines.append(
                    f"  - {evidence['timestamp']} | {evidence['component_id']} | {evidence['field']} = {evidence['value']}"
                )

        lines.extend(
            [
                "",
                "This answer is generated only from the provided agent analysis. It does not replace the selected action plan.",
            ]
        )

        return "\n".join(lines)

    def rewrite(self, source_text: str) -> str:
        return source_text


class OllamaLLMClient:
    provider = "ollama"

    def __init__(self, model: str | None = None, base_url: str | None = None) -> None:
        """Configure an Ollama-backed LLM client from arguments or environment.

        @param model: Optional Ollama model name.
        @param base_url: Optional Ollama base URL.
        @return: None.
        """
        self.model = model or os.getenv("AGENT_LLM_MODEL", "llama3.2")
        self.base_url = (base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")).rstrip("/")

    def generate(self, messages: list[dict[str, str]]) -> str:
        """Send chat messages to Ollama and return the model content.

        @param messages: Chat messages generated from grounded agent context.
        @return: Model response content.
        @raises RuntimeError: If Ollama cannot be reached or returns no content.
        """
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.2,
            },
        }

        request = Request(
            url=f"{self.base_url}/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urlopen(request, timeout=120) as response:
                response_data = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Ollama HTTP error {error.code}: {body}") from error
        except URLError as error:
            raise RuntimeError(f"Could not connect to Ollama at {self.base_url}. Is Ollama running?") from error
        except TimeoutError as error:
            raise RuntimeError("Ollama request timed out") from error

        message = response_data.get("message", {})
        content = message.get("content")

        if not content:
            raise RuntimeError(f"Ollama returned an empty response: {response_data}")

        return content
    
    def rewrite(self, source_text: str) -> str:
        """Ask Ollama to rewrite a grounded source summary without changing facts.

        @param source_text: Deterministic source summary produced by the agent.
        @return: Rewritten plain-text summary.
        @raises RuntimeError: If Ollama cannot be reached or returns no content.
        """
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Rewrite the provided maintenance summary to make it clearer and more readable. "
                        "Do not add, remove, or change any technical facts, numbers, actions, statuses, timestamps, priorities, or component names. "
                        "Do not introduce new causes, downtime, cost, urgency, or production impact. "
                        "Keep all recommendations and evidence. "
                        "Return plain text only. Do not use Markdown. "
                        "Your response must contain zero asterisk characters. "
                        "Do not use bold, italics, code blocks, headings, tables, or bullet markers. "
                        "Use short plain paragraphs or simple plain lines only."
                    ),
                },
                {
                    "role": "user",
                    "content": source_text,
                },
            ],
            "stream": False,
            "options": {
                "temperature": 0.0,
            },
        }

        request = Request(
            url=f"{self.base_url}/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urlopen(request, timeout=120) as response:
                response_data = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Ollama HTTP error {error.code}: {body}") from error
        except URLError as error:
            raise RuntimeError(f"Could not connect to Ollama at {self.base_url}. Is Ollama running?") from error
        except TimeoutError as error:
            raise RuntimeError("Ollama request timed out") from error

        message = response_data.get("message", {})
        content = message.get("content")

        if not content:
            raise RuntimeError(f"Ollama returned an empty response: {response_data}")

        return content


def build_llm_client(provider: str = "mock", model: str | None = None) -> LLMClient:
    """Construct the configured LLM client implementation.

    @param provider: Provider name, such as mock, ollama, or local.
    @param model: Optional model name for provider-backed clients.
    @return: LLM client implementation.
    @raises ValueError: If the provider is unsupported.
    """
    normalized_provider = provider.lower().strip()

    if normalized_provider == "mock":
        return MockLLMClient()

    if normalized_provider in {"ollama", "local"}:
        return OllamaLLMClient(model=model)

    raise ValueError(f"Unsupported LLM provider: {provider}")


def extract_context(messages: list[dict[str, str]]) -> dict[str, Any]:
    """Extract serialized LLM context from the latest user message.

    @param messages: Chat messages passed to a mock generation client.
    @return: Parsed context dictionary.
    @raises ValueError: If no user message is present.
    """
    for message in reversed(messages):
        if message["role"] == "user":
            return json.loads(message["content"])

    raise ValueError("No user message found in LLM messages")
