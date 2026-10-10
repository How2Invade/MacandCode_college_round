import os
from pathlib import Path

from sarvamai import SarvamAI


def load_project_env() -> None:
    """Load SARVAM_API_KEY from this project's .env without extra dependencies."""
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return

    for line in env_path.read_text().splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() == "SARVAM_API_KEY" and not os.environ.get(key.strip()):
            os.environ[key.strip()] = value.strip().strip('"').strip("'")


def main() -> None:
    load_project_env()
    api_key = os.environ.get("SARVAM_API_KEY")
    if not api_key:
        raise SystemExit("Paste your Sarvam key into SARVAM_API_KEY in .env, then run this script again.")

    client = SarvamAI(api_subscription_key=api_key)
    response = client.chat.completions(
        model="sarvam-105b-conversations",
        messages=[{"role": "user", "content": "Say hello in one short sentence."}],
    )
    print(response.choices[0].message.content)


if __name__ == "__main__":
    main()
