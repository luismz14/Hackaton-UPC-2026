import { useEffect, useMemo, useState } from 'react';
import './styles/App.css';
import ChatbotPanel from './components/ChatbotPanel';
import HealthSummary from './components/HealthSummary';
import HumanDependencyMap from './components/HumanDependencyMap';
import LlmOutputPanel from './components/LlmOutputPanel';
import MessagesPanel from './components/MessagesPanel';
import PredictionPanel from './components/PredictionPanel';
import Printer3DModel from './components/Printer3DModel';
import SimulationControls from './components/SimulationControls';
import TimelineChart from './components/TimelineChart';
import { HUMAN_DEPENDENCIES } from './data/dependencies';
import { DEFAULT_SIMULATION_CONFIG } from './data/defaultConfig';
import { fetchAgentLlmAnswer } from './services/agentApi';
import { getRunTimeline, listRuns } from './services/historianApi';
import { fetchRunMessages } from './services/messagesApi';
import { fetchCurrentModel, fetchPrediction } from './services/modelApi';
import { buildAxisTemplate, runSimulation } from './services/simulationApi';

export default function App() {
  const [modelState, setModelState] = useState(null);
  const [selectedComponentId, setSelectedComponentId] = useState('heating_elements');
  const [config, setConfig] = useState(DEFAULT_SIMULATION_CONFIG);
  const [timeline, setTimeline] = useState([]);
  const [prediction, setPrediction] = useState(null);
  const [messages, setMessages] = useState([]);
  const [llmOutput, setLlmOutput] = useState(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState('');
  const [dependencies, setDependencies] = useState([]);
  const [historianState, setHistorianState] = useState({ runs: [], latestRun: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    document.title = 'SimuFlow | Industrial Digital Twin';
  }, []);

  useEffect(() => {
    let active = true;

    /**
     * Loads prediction and dependency context whenever the selected component changes.
     *
     * @returns {Promise<void>} Resolves after component context has been refreshed.
     */
    async function loadSelectedComponentContext() {
      if (!timeline.length) return;
      const activeRunId = timeline[0]?.run_id || historianState.latestRun?.run_id;
      setDependencies(extractDependenciesFromTimeline(timeline, selectedComponentId));

      if (!activeRunId) {
        setPrediction(null);
        return;
      }

      try {
        const selectedPrediction = await fetchPrediction(activeRunId, selectedComponentId);
        if (active) {
          setPrediction(selectedPrediction);
        }
      } catch (predictionError) {
        if (active) {
          setPrediction(null);
        }
      }
    }

    loadSelectedComponentContext();
    return () => {
      active = false;
    };
  }, [selectedComponentId, timeline, historianState.latestRun?.run_id]);

  useEffect(() => {
    let active = true;
    const activeRunId = historianState.latestRun?.run_id;

    /**
     * Loads the agent-backed LLM explanation for the active stored run.
     *
     * @returns {Promise<void>} Resolves after the LLM panel state has been updated.
     */
    async function loadLlmOutput() {
      if (!activeRunId) {
        setLlmOutput(null);
        setLlmError('');
        setLlmLoading(false);
        return;
      }

      setLlmLoading(true);
      setLlmError('');

      try {
        const answer = await fetchAgentLlmAnswer(activeRunId);
        if (!active) return;
        setLlmOutput(answer);
      } catch (answerError) {
        if (!active) return;
        setLlmOutput(null);
        setLlmError(answerError.message || 'Failed to generate the LLM output.');
      } finally {
        if (active) {
          setLlmLoading(false);
        }
      }
    }

    loadLlmOutput();
    return () => {
      active = false;
    };
  }, [historianState.latestRun?.run_id]);

  useEffect(() => {
    let active = true;

    /**
     * Loads initial model state, historian metadata, and latest run artifacts.
     *
     * @returns {Promise<void>} Resolves after the dashboard bootstrap sequence completes.
     */
    async function loadInitialData() {
      try {
        const [currentModel, runsPayload] = await Promise.all([fetchCurrentModel(), listRuns()]);
        if (!active) return;

        const latestRun = selectInitialRun(runsPayload);
        setModelState(currentModel);
        setHistorianState({
          runs: runsPayload.runs || [],
          latestRun
        });

        if (!latestRun) return;
        setConfig(configFromRun(latestRun));

        const [latestTimeline, latestMessages] = await Promise.all([
          getRunTimeline(latestRun.run_id),
          fetchRunMessages(latestRun.run_id)
        ]);
        if (!active) return;

        const normalizedTimeline = normalizeTimelineForUi(latestTimeline);
        const latestSelectedComponent = latestRun.selected_component || 'heating_elements';
        setTimeline(normalizedTimeline);
        setMessages(latestMessages);
        setSelectedComponentId(latestSelectedComponent);
        setDependencies(extractDependenciesFromTimeline(normalizedTimeline, latestSelectedComponent));
        if (latestSelectedComponent) {
          const latestPrediction = await fetchPrediction(latestRun.run_id, latestSelectedComponent);
          if (!active) return;
          setPrediction(latestPrediction);
        }
      } catch (loadError) {
        if (!active) return;
        setError(loadError.message || 'Failed to load application data.');
      }
    }

    loadInitialData();
    return () => {
      active = false;
    };
  }, []);

  const latestOutput = timeline.length > 0 ? timeline[timeline.length - 1].model_output : modelState;
  const displayModelState = useMemo(
    () => mergeModelStates(modelState, latestOutput),
    [modelState, latestOutput]
  );

  const chartData = useMemo(() => {
    if (!timeline.length) return [];

    return timeline
      .map((point) => {
        const component = point.model_output?.components?.[selectedComponentId];
        if (!component) return null;
        return {
          usage_count: point.usage_count,
          health: component.health,
          status: component.status
        };
      })
      .filter(Boolean);
  }, [timeline, selectedComponentId]);

  const effectiveUsageStep = useMemo(
    () => getEffectiveUsageStep(config.totalUsages, config.usageStep),
    [config.totalUsages, config.usageStep]
  );
  const axisTemplate = useMemo(
    () => buildAxisTemplate(config.totalUsages, effectiveUsageStep),
    [config.totalUsages, effectiveUsageStep]
  );

  const liveProgress = useMemo(() => {
    if (!timeline.length) return 0;
    const totalUsages = Number(config.totalUsages) || 1;
    const latestUsage = Number(timeline.at(-1)?.usage_count || 0);
    return Math.max(0, Math.min(100, Math.round((latestUsage / totalUsages) * 100)));
  }, [timeline, config.totalUsages]);

  const overallHealth = Math.round((displayModelState?.machine_state?.overall_health || 0) * 100);
  const activeRunId = historianState.latestRun?.run_id || 'No run';
  const currentStatus = displayModelState?.machine_state?.overall_status || 'UNKNOWN';
  const hasSimulationRun = timeline.length > 0;

  /**
   * Runs a persisted backend simulation and refreshes all dependent dashboard state.
   *
   * @returns {Promise<void>} Resolves after the run completes or the error state is set.
   */
  async function handleRunTimeline() {
    setLoading(true);
    setError('');
    setPrediction(null);
    setMessages([]);
    setLlmOutput(null);
    setLlmError('');
    setDependencies([]);
    setTimeline([]);

    let payload;
    try {
      payload = toBackendSimulationConfig(config, selectedComponentId);
    } catch (configError) {
      setLoading(false);
      setError(configError.message);
      return;
    }

    try {
      const response = await runSimulation(payload);
      if (!response.timeline || response.timeline.length === 0) {
        throw new Error('Simulation returned no timeline points.');
      }
      const normalizedTimeline = normalizeTimelineForUi(response.timeline);

      const mappedData = normalizedTimeline.map((point) => {
        const component = point.model_output?.components?.[selectedComponentId];
        if (!component) {
          throw new Error('Selected component was not found in model output.');
        }
        return {
          usage_count: point.usage_count,
          health: component.health,
          status: component.status
        };
      });

      if (mappedData.length === 0) {
        throw new Error('Simulation returned no timeline points.');
      }

      setTimeline(normalizedTimeline);
      setPrediction(response.prediction || null);
      setMessages(response.messages || []);
      setDependencies(response.dependencies || []);
      setModelState(normalizedTimeline.at(-1).model_output);

      const runsPayload = await listRuns();
      setHistorianState({
        runs: runsPayload.runs || [],
        latestRun: runsPayload.latest_run || null
      });
    } catch (runError) {
      setError(runError.message || 'Simulation request failed.');
    } finally {
      setLoading(false);
    }
  }

  if (!modelState) {
    return <div className="loading-screen">{error || 'Loading SimuFlow control room...'}</div>;
  }

  return (
    <main className="simuflow-app">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <div className="ambient ambient-c" />

      <header className="app-header panel">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <LogoMark />
          </div>
          <div>
            <p className="brand-name">SimuFlow</p>
            <div className="brand-meta">
              <span className="brand-version">v1.0.0</span>
              <span className="brand-separator" />
              <span className="live-chip">
                <span className="live-dot" />
                Digital twin connected
              </span>
            </div>
          </div>
        </div>

      </header>

      <div className="dashboard-grid">
        <section className="panel hero-panel dashboard-tile tile-span-5">
          <div className="section-title-row compact">
            <div>
              <p className="eyebrow">Runtime timeline</p>
              <h2>Simulation lifecycle</h2>
            </div>
            <div className="hero-status-row">
              <span className="live-chip">
                <span className="live-dot" />
                Real-time
              </span>
              <span className="axis-chip">{timeline.length ? `${timeline.length} checkpoints` : 'No active run'}</span>
              <span className="axis-chip">{currentStatus}</span>
            </div>
          </div>

          <div className="hero-stats">
            <MiniStat label="Current time" value={historianState.latestRun?.current_time || '01:20:35'} helper="Runtime clock" />
            <MiniStat label="Total duration" value={historianState.latestRun?.duration || '02:00:00'} helper="Configured window" />
            <MiniStat label="Machine health" value={`${overallHealth}%`} helper="Fleet aggregate" tone="green" />
            <MiniStat label="Critical components" value={String(displayModelState?.machine_state?.critical_components?.length || 0)} helper="Active alerts" tone="amber" />
          </div>

          <TimelineChart
            chartData={chartData}
            axisTemplate={axisTemplate}
            totalUsages={config.totalUsages}
            modelState={displayModelState}
            selectedComponentId={selectedComponentId}
            onSelectComponent={setSelectedComponentId}
            loading={loading}
            error={error}
          />
        </section>

        <section className="sidebar-row tile-span-5">
          <section className="panel simulation-panel sidebar-block sidebar-panel">
            <SimulationControls
              config={config}
              setConfig={setConfig}
              running={loading}
              onRun={handleRunTimeline}
              historianSummary={{
                runs: historianState.runs.length,
                points: timeline.length,
                lastRun: historianState.latestRun,
                status: timeline.length ? 'Real-time' : 'Ready',
                progress: timeline.length ? `${liveProgress}%` : '0%'
              }}
              error={error}
            />
          </section>

          <section className="panel quick-status-panel sidebar-block sidebar-panel">
            <div className="section-title-row compact">
              <div>
                <p className="eyebrow">System pulse</p>
                <h2>{activeRunId}</h2>
              </div>
              <span className={`status-pill ${currentStatus.toLowerCase()}`}>{currentStatus}</span>
            </div>
            <div className="pulse-grid">
              <div>
                <span>Progress</span>
                <strong>{timeline.length ? `${liveProgress}%` : 'Idle'}</strong>
              </div>
              <div>
                <span>Scenario</span>
                <strong>{historianState.latestRun?.scenario_id || config.scenarioId}</strong>
              </div>
              <div>
                <span>Component</span>
                <strong>{selectedComponentId.replaceAll('_', ' ')}</strong>
              </div>
              <div>
                <span>Prediction</span>
                <strong>{prediction?.predicted_failure_usage || 'Pending'}</strong>
              </div>
            </div>
          </section>
        </section>

        <HealthSummary
          className={`tile-fill tile-span-2 ${hasSimulationRun ? '' : 'no-run-top'}`.trim()}
          modelState={displayModelState}
          selectedComponentId={selectedComponentId}
        />

        <PredictionPanel className="tile-fill tile-span-3" prediction={prediction} />

        <Printer3DModel
          className="tile-fill tile-model tile-span-5"
          modelState={displayModelState}
          selectedComponentId={selectedComponentId}
          onSelect={setSelectedComponentId}
        />

        <MessagesPanel
          className={`tile-fill tile-messages tile-span-2 ${hasSimulationRun ? '' : 'no-run-top'}`.trim()}
          messages={messages}
        />

        <HumanDependencyMap
          className={`tile-fill tile-dependency tile-span-3  ${hasSimulationRun ? '' : 'no-run-top'}`.trim()}
          selectedComponentId={selectedComponentId}
          dependencies={dependencies}
        />

        <LlmOutputPanel
          className="tile-fill tile-span-5"
          output={llmOutput}
          loading={llmLoading}
          error={llmError}
        />

      </div>

      <button
        type="button"
        className="chat-fab"
        aria-label="Open chat"
        onClick={() => setChatOpen(true)}
      >
        <ChatIcon />
      </button>

      {chatOpen ? (
        <div className="chat-modal-backdrop" role="presentation" onClick={() => setChatOpen(false)}>
          <section
            className="chat-modal panel"
            role="dialog"
            aria-modal="true"
            aria-label="Chatbot panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="chat-modal-header">
              <div>
                <p className="eyebrow">Codex chat</p>
                <h2>History and grounded assistance</h2>
              </div>
              <button type="button" className="icon-button transparent" onClick={() => setChatOpen(false)} aria-label="Close chat">
                <CloseIcon />
              </button>
            </div>
            <ChatbotPanel
              runId={historianState.latestRun?.run_id || null}
              selectedComponentId={selectedComponentId}
              disabled={!historianState.latestRun?.run_id}
            />
          </section>
        </div>
      ) : null}
    </main>
  );
}

/**
 * Converts UI simulation state into the backend simulation-run contract.
 *
 * @param {object} config - UI simulation settings.
 * @param {string} selectedComponentId - Component selected for prediction and focus.
 * @returns {object} Backend request payload using snake_case field names.
 * @throws {Error} When required numeric or scenario fields are invalid.
 */
function toBackendSimulationConfig(config, selectedComponentId) {
  const totalUsages = Number(config.totalUsages);
  const temperatureC = Number(config.temperatureC);
  const humidity = Number(config.humidity);
  const contamination = Number(config.contamination);
  const operationalLoad = Number(config.operationalLoad);
  const maintenanceLevel = Number(config.maintenanceLevel);
  const stochasticity = getFiniteNumber(config.stochasticity, DEFAULT_SIMULATION_CONFIG.stochasticity);
  const seed = getFiniteNumber(config.seed, DEFAULT_SIMULATION_CONFIG.seed);
  const scenarioId = String(config.scenarioId || DEFAULT_SIMULATION_CONFIG.scenarioId || '').trim();

  if (!Number.isFinite(totalUsages) || totalUsages <= 0) {
    throw new Error('Invalid simulation config: total_usages must be greater than 0.');
  }
  if (!scenarioId) {
    throw new Error('Invalid simulation config: scenario_id is required.');
  }

  const usageStep = getEffectiveUsageStep(totalUsages, config.usageStep);

  return {
    run_id: `run_${Date.now()}`,
    scenario_id: scenarioId,
    total_usages: totalUsages,
    usage_step: usageStep,
    initial_conditions: {
      temperature_c: temperatureC,
      humidity,
      contamination,
      operational_load: operationalLoad,
      maintenance_level: maintenanceLevel,
      stochasticity
    },
    selected_component: selectedComponentId,
    seed
  };
}

/**
 * Selects the most useful run to hydrate the dashboard on startup.
 *
 * @param {object} runsPayload - Historian response containing available runs.
 * @returns {object|null} Preferred complete run, latest run, or null.
 */
function selectInitialRun(runsPayload) {
  const runs = runsPayload?.runs || [];
  const defaultTotalUsages = Number(DEFAULT_SIMULATION_CONFIG.totalUsages);
  const completeRun = runs.find((run) => Number(run.total_usages) >= defaultTotalUsages);

  return completeRun || runsPayload?.latest_run || null;
}

/**
 * Reconstructs editable UI simulation settings from stored run metadata.
 *
 * @param {object} run - Historian run metadata with persisted configuration.
 * @returns {object} UI configuration merged with dashboard defaults.
 */
function configFromRun(run) {
  const rawConfig = run?.config || {};
  const initialConditions = rawConfig.initial_conditions || {};

  return {
    ...DEFAULT_SIMULATION_CONFIG,
    scenarioId: rawConfig.scenario_id || run?.scenario_id || DEFAULT_SIMULATION_CONFIG.scenarioId,
    totalUsages: getFiniteNumber(
      rawConfig.total_usages ?? run?.total_usages,
      DEFAULT_SIMULATION_CONFIG.totalUsages
    ),
    usageStep: getFiniteNumber(
      rawConfig.usage_step ?? run?.usage_step,
      DEFAULT_SIMULATION_CONFIG.usageStep
    ),
    temperatureC: getFiniteNumber(
      initialConditions.temperature_c,
      DEFAULT_SIMULATION_CONFIG.temperatureC
    ),
    humidity: getFiniteNumber(initialConditions.humidity, DEFAULT_SIMULATION_CONFIG.humidity),
    contamination: getFiniteNumber(
      initialConditions.contamination,
      DEFAULT_SIMULATION_CONFIG.contamination
    ),
    operationalLoad: getFiniteNumber(
      initialConditions.operational_load,
      DEFAULT_SIMULATION_CONFIG.operationalLoad
    ),
    maintenanceLevel: getFiniteNumber(
      initialConditions.maintenance_level,
      DEFAULT_SIMULATION_CONFIG.maintenanceLevel
    ),
    stochasticity: getFiniteNumber(initialConditions.stochasticity, DEFAULT_SIMULATION_CONFIG.stochasticity),
    seed: getFiniteNumber(rawConfig.seed, DEFAULT_SIMULATION_CONFIG.seed)
  };
}

function getFiniteNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

/**
 * Computes a positive usage step that cannot exceed the configured run length.
 *
 * @param {number|string} totalUsages - Configured total usage count.
 * @param {number|string} configuredUsageStep - User-provided usage step.
 * @returns {number} Safe usage step used by the chart and backend payload.
 */
function getEffectiveUsageStep(totalUsages, configuredUsageStep) {
  const total = Number(totalUsages);
  const configuredStep = Number(configuredUsageStep);
  const defaultStep = Number(DEFAULT_SIMULATION_CONFIG.usageStep);
  const usageStep = Number.isFinite(configuredStep) && configuredStep > 0 ? configuredStep : defaultStep;
  const positiveUsageStep = Math.max(1, usageStep);

  if (!Number.isFinite(total) || total <= 0) {
    return positiveUsageStep;
  }

  return Math.max(1, Math.min(positiveUsageStep, total));
}

/**
 * Filters human-readable dependencies to those relevant to the selected component.
 *
 * @param {Array<object>} timeline - Normalized timeline shown in the dashboard.
 * @param {string} selectedComponentId - Component selected by the user.
 * @returns {Array<object>} Dependencies where the selected component is source or target.
 */
function extractDependenciesFromTimeline(timeline, selectedComponentId) {
  if (!timeline?.length) return [];
  const finalPoint = timeline[timeline.length - 1];
  const components = finalPoint.model_output?.components || {};
  if (!components[selectedComponentId]) return [];
  return HUMAN_DEPENDENCIES.filter(
    (dependency) => dependency.source === selectedComponentId || dependency.target === selectedComponentId
  );
}

/**
 * Normalizes historian timeline records into the same shape as live simulation output.
 *
 * @param {Array<object>} timeline - Timeline from the backend or historian API.
 * @returns {Array<object>} Timeline points with model_output and component health fields.
 */
function normalizeTimelineForUi(timeline) {
  return (timeline || []).map((point) => {
    if (point.model_output?.components) {
      return point;
    }

    const components = Object.fromEntries(
      Object.entries(point.components || {}).map(([componentId, component]) => [
        componentId,
        {
          subsystem: component.subsystem,
          health: component.health_index,
          status: component.status,
          damage: component.damage || {},
          metrics: component.metrics || {},
          alerts: component.alerts || []
        }
      ])
    );

    return {
      ...point,
      model_output: {
        machine_state: buildMachineStateFromComponents(components),
        components
      }
    };
  });
}

/**
 * Merges the default model snapshot with the latest available component state.
 *
 * @param {object|null} baseModelState - Initial model snapshot from the backend.
 * @param {object|null} latestModelState - Latest timeline model state, when available.
 * @returns {object} Aggregated model state used by summary and 3D panels.
 */
function mergeModelStates(baseModelState, latestModelState) {
  const components = {
    ...(baseModelState?.components || {}),
    ...(latestModelState?.components || {})
  };

  return {
    machine_state: buildMachineStateFromComponents(components),
    components
  };
}

/**
 * Recomputes aggregate machine health and status from component states.
 *
 * @param {object} components - Component map keyed by component identifier.
 * @returns {object} Machine-state summary with overall health and critical lists.
 */
function buildMachineStateFromComponents(components) {
  const componentValues = Object.values(components);
  const overallHealth = componentValues.length
    ? componentValues.reduce((sum, component) => sum + component.health, 0) / componentValues.length
    : 1;
  const criticalComponents = Object.entries(components)
    .filter(([, component]) => component.status === 'CRITICAL')
    .map(([componentId]) => componentId);
  const failedComponents = Object.entries(components)
    .filter(([, component]) => component.status === 'FAILED')
    .map(([componentId]) => componentId);

  let overallStatus = 'FUNCTIONAL';
  if (failedComponents.length) {
    overallStatus = 'FAILED';
  } else if (criticalComponents.length) {
    overallStatus = 'CRITICAL';
  } else if (componentValues.some((component) => component.status === 'DEGRADED')) {
    overallStatus = 'DEGRADED';
  }

  return {
    overall_health: Number(overallHealth.toFixed(4)),
    overall_status: overallStatus,
    critical_components: criticalComponents,
    failed_components: failedComponents
  };
}

function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="SimuFlow logo">
      <path d="M16 2.5 27.5 9v14L16 29.5 4.5 23V9Z" />
      <path d="M16 8.2 22 11.8v8.4L16 23.8 10 20.2v-8.4Z" />
    </svg>
  );
}





function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.5h14v10H10l-4.3 3v-3H5v-10Zm2 2v6h9.4V7.5H7Zm1.5 1.6h6.4v1.4H8.5V9.1Zm0 2.6h4.9v1.4H8.5v-1.4Z" />
    </svg>
  );
}




function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}



function MiniStat({ label, value, helper, tone = 'blue' }) {
  return (
    <div className={`mini-stat mini-stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  );
}
