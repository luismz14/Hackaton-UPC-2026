# Hackaton-UPC-2026

This repository contains a predictive maintenance and digital twin platform for the HP Metal Jet S100. It models how key printer components degrade under operational and environmental stress, simulates their evolution over time, and stores that telemetry so it can be queried through dashboards and grounded maintenance-oriented interfaces. In practice, the repository combines mathematical degradation models, a simulation backend with historian persistence, and interaction layers for diagnosis and decision support.

## Architecture

The solution is organized as a modular system with a clear separation between simulation, prediction, orchestration, and visualization:

- `frontend/`: React + Vite dashboard for visualizing component health, alerts, dependencies, and simulation timelines.
- `backend/`: application layer exposing the core prediction, simulation, storage, and chatbot/agent-facing services.
- `agent/`: agent logic and scripts used to support interaction, orchestration, and scenario handling.
- `model_mathematic/`: mathematical models for each subsystem and component degradation behavior.
- `data/`: synthetic histories, example contexts, and agent scenarios used to test the system.
- `docs/`, `config/`, and `tests/`: authored documentation, simulation figures, configuration and validation. External GLBs and supplied briefs are excluded; see [DATA_ASSETS.md](DATA_ASSETS.md).

At a high level, the repository follows the three hackathon phases: `model_mathematic/` implements the Phase 1 degradation models, `backend/` executes the Phase 2 simulation and historian workflow, and `agent/` plus `frontend/` provide the Phase 3 interaction and decision-support layers. The mathematical models generate the health and degradation behavior of each subsystem, the backend coordinates predictions and storage, and the frontend presents the results through dashboards and timelines.

## Prerequisites

Install the following tools before running the project:

- Python 3.10 or newer.
- Node.js 18 or newer, with npm.
- Git, if you are cloning the repository.
- Optional: Ollama, if you want to use the local LLM explanation flow instead of the mock LLM provider.

The backend currently reads environment variables from `backend/.env`. Start commands below from the repository root unless a `cd` command specifies otherwise. For the local Ollama-backed flows, use:

```env
OLLAMA_BASE_URL=http://localhost:11434
AGENT_LLM_PROVIDER=ollama
AGENT_LLM_MODEL=llama3.2:3b
```

`AGENT_LLM_PROVIDER` and `AGENT_LLM_MODEL` configure the agent explanation flow, while `OLLAMA_MODEL` is used by the backend chatbot path.

If Ollama is not installed or running, use the mock provider for the frontend agent panel by creating `frontend/.env.local` with:

```env
VITE_AGENT_LLM_PROVIDER=mock
```

## Installation

Clone the repository and enter the project directory:

```bash
git clone https://github.com/arnaumunozbarrera/Hackaton-UPC-2026.git
cd Hackaton-UPC-2026
```

Create and activate a Python virtual environment for the backend:

```bash
cd backend
python -m venv .venv
```

On Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

On macOS or Linux:

```bash
source .venv/bin/activate
```

Install the backend dependencies:

```bash
python -m pip install -r requirements.txt
```

Install the frontend dependencies from a second terminal opened at the repository root:

```bash
cd frontend
npm install
```

## Usage

Start the backend API:

```bash
cd backend
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend will be available at:

- API health check: `http://localhost:8000/api/health`
- Interactive API documentation: `http://localhost:8000/docs`

Start the frontend dashboard from another terminal opened at the repository root:

```bash
cd frontend
npm run dev
```

Open the dashboard at `http://localhost:5173`.

By default, the frontend calls the backend at `http://localhost:8000`. To use a different backend URL, create `frontend/.env.local` and set:

```env
VITE_API_BASE_URL=http://localhost:8000
```

To use the Ollama-backed agent explanation flow, make sure Ollama is running and that the configured model is available. If you are not using the Ollama desktop application, start the Ollama server first:

```bash
ollama serve
```

Then pull the configured model from another terminal:

```bash
ollama pull llama3.2:3b
```

Run the automated tests from the repository root:

```bash
python -m pip install pytest
python -m pytest tests
```

The backend creates its local SQLite historian database automatically under `backend/storage/` when the API starts.

## Typical Flow

A typical end-to-end run through the project looks like this:

- Open the frontend to inspect the current component snapshot exposed by the backend model endpoints.
- Launch a simulation run so the backend advances component degradation over time and persists each step in the SQLite historian.
- Review the generated timeline, component health trends, alerts, and dependency effects in the dashboard.
- Query the resulting run through the chat and agent-backed analysis paths to obtain grounded maintenance explanations based on stored telemetry.

## Elements

The main implemented elements of the project are:

- Subsystem-level mathematical models for components such as cleaning interface, heating elements, insulation panels, linear guide, nozzle plate, recoater blade, recoater drive motor, temperature sensors, and thermal firing resistors.
- A logic engine to combine subsystem behavior into machine-level health interpretation.
- A backend structure for prediction, simulation, schema definition, storage, and agent/chatbot integration.
- A frontend dashboard with component selection, health visualization, alerts, dependency impact display, and timeline-based monitoring.
- Synthetic data and agent scenarios to validate the behavior of the platform under different maintenance situations.

## Results & Conclusion

The implemented prediction layer combines several degradation functions depending on the physical behavior of each component family:

- Linear degradation for components whose wear grows approximately in proportion to use and environmental stress.
- Exponential decay for thermal and electrical components whose degradation accelerates with accumulated operating stress.
- Weibull-based degradation for components with fatigue behavior and increasing failure risk over time.

### Linear Prediction Function

The linear formulation is used for components such as the recoater blade, linear guide, cleaning interface, temperature sensors, and insulation panels.

![Linear prediction function](docs/lineal.jpeg)

### Exponential Prediction Function

The exponential formulation is used for components such as heating elements and thermal firing resistors, where damage compounds under repeated thermal and electrical cycles.

![Exponential prediction function](docs/exp.jpeg)

### Weibull Prediction Function

The Weibull formulation is used for the recoater drive motor to represent fatigue accumulation and a non-linear increase in failure probability as effective age grows.

![Weibull prediction function](docs/weibull.jpeg)

### Prototype scope

The implementation combines deterministic component models, synthetic histories, a simulation API, and dashboard/agent interfaces. The repository provides scenarios and tests for these software contracts. It does not establish predictive accuracy on production HP Metal Jet telemetry or validated maintenance schedules.

## Development limitations

- `backend/requirements.txt` pins the backend runtime dependencies. `pytest` is a separate development tool.
- The frontend intentionally disables and ignores `package-lock.json`; exact transitive dependency recreation is not guaranteed.
- Vite historically serves `3d-models/` through `publicDir`. All nine external GLBs are excluded for unresolved authorship/license. The 3D view requires separately supplied authorized local assets and can be incomplete without them; no redesign was implemented.
- Ollama-backed features require a running local service and the configured model; the agent panel also supports the documented mock provider.
- No source-code license is included. [DATA_ASSETS.md](DATA_ASSETS.md) distinguishes synthetic fixtures, authored illustrations and excluded third-party material.

## Future Improvements

Two complementary improvement approaches are considered:

1. Enrich the model with historical health trajectories and contextual operating data.
   A major improvement would be to incorporate time-series records showing how each component's health has evolved under specific operating conditions. Instead of relying only on a compact synthetic description of usage, the model would learn from the combination of health evolution and the parameters present at each moment, such as temperature, humidity, degradation rate, contamination, maintenance events, and other operational variables.

   This historical knowledge would be especially valuable for forecasting. By understanding how health has fluctuated over time in response to different conditions, the model could identify more realistic degradation patterns and produce more reliable predictions of future behavior. In practice, this would allow the digital twin to:
   - Recognize how similar health states can lead to different outcomes depending on the operating context.
   - Capture cumulative and long-term effects that are only visible through historical evolution.
   - Improve forecast quality by basing predictions on observed health trajectories rather than on simplified assumptions.
   - Make the model progressively less synthetic and more representative of real machine behavior if production telemetry becomes available.

2. Focus the solution on warning generation and maintenance date estimation.
   The goal is to evolve the system into a decision-support tool that not only detects degradation, but also helps determine when the replacement process should begin.

   A key improvement would be to incorporate historical data about the total elapsed time between identifying that a component needs replacement and the moment the replacement is actually completed. Knowing this time for each component, together with other temporal operational data, would make it possible to plan interventions earlier and more accurately.

   This would be especially valuable because the optimal decision is not only when to replace a part, but when to start preparing that replacement so it happens at the right moment. In practice, this would allow the platform to:
   - Trigger warnings early enough to account for the real lead time of each component.
   - Estimate when the replacement planning should start, not only when the intervention should occur.
   - Adapt maintenance timing to the historical replacement dynamics of different components and suppliers.
   - Reduce the risk of reacting too late or replacing parts unnecessarily early.
   - Turn health forecasts into more actionable maintenance planning decisions.

   In business terms, this would make the system more useful for planning, not only for monitoring. The final value would come from converting health predictions into concrete recommendations about when to initiate the replacement process so that maintenance is executed at the optimal time.
