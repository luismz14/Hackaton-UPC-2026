from math import ceil

from agent.src.health import CRITICAL_HEALTH_THRESHOLD, FAILED_HEALTH_THRESHOLD, status_from_health
from agent.src.risk import compute_risk_score
from agent.src.schemas import Forecast


def forecast_from_health_trend(history: list[dict], component_id: str, horizon_steps: int) -> Forecast:
    """Forecast component status from the observed average health trend.

    The trend treats records as equally spaced steps; timestamps and usage
    intervals are not used to estimate the slope.

    @param history: Ordered historian records.
    @param component_id: Component identifier to forecast.
    @param horizon_steps: Number of future steps to project.
    @return: Forecast with predicted status, risk, and threshold timing.
    """
    component_history = [
        record
        for record in history
        if component_id in record.get("components", {})
    ]

    if len(component_history) < 2:
        return Forecast(
            horizon_steps=horizon_steps,
            predicted_status="UNKNOWN",
            time_to_critical_steps=None,
            time_to_failure_steps=None,
            risk_score=0.0,
        )

    first = component_history[0]["components"][component_id]["health_index"]
    last = component_history[-1]["components"][component_id]["health_index"]
    steps = len(component_history) - 1
    degradation_rate = max((first - last) / steps, 0.0)

    if degradation_rate == 0.0:
        predicted_status = status_from_health(last)
        return Forecast(
            horizon_steps=horizon_steps,
            predicted_status=predicted_status,
            time_to_critical_steps=None,
            time_to_failure_steps=None,
            risk_score=compute_risk_score(last, predicted_status),
        )

    time_to_critical = ceil((last - CRITICAL_HEALTH_THRESHOLD) / degradation_rate) if last > CRITICAL_HEALTH_THRESHOLD else 0
    time_to_failure = ceil((last - FAILED_HEALTH_THRESHOLD) / degradation_rate) if last > FAILED_HEALTH_THRESHOLD else 0

    future_health = max(0.0, last - degradation_rate * horizon_steps)
    predicted_status = status_from_health(future_health)
    risk_score = compute_risk_score(future_health, predicted_status)

    return Forecast(
        horizon_steps=horizon_steps,
        predicted_status=predicted_status,
        time_to_critical_steps=max(time_to_critical, 0),
        time_to_failure_steps=max(time_to_failure, 0),
        risk_score=risk_score,
    )
