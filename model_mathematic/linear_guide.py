"""Linear Guide degradation model for the recoating system."""

from .common import (
    HEALTH_PRECISION,
    clamp,
    get_component_config,
    get_previous_health,
    get_reported_damage,
    get_status_from_health,
    snap_health_to_failure_threshold,
    split_damage_by_pressure,
)


COMPONENT_NAME = "linear_guide"


def _build_alerts(
    status,
    friction_coefficient,
    straightness_error_mm,
    carriage_drag_factor,
    alerts_config,
):
    """Build threshold alerts for rail friction, straightness, and carriage drag.

    @param status: Component status after the current degradation step.
    @param friction_coefficient: Current estimated guide friction coefficient.
    @param straightness_error_mm: Current straightness error in millimeters.
    @param carriage_drag_factor: Current normalized carriage drag factor.
    @param alerts_config: Alert thresholds from the component configuration.
    @return: Alert dictionaries describing threshold breaches.
    """
    alerts = []

    if friction_coefficient >= alerts_config["high_friction_threshold"]:
        alerts.append(
            {
                "severity": "WARNING",
                "code": "HIGH_GUIDE_FRICTION",
                "message": "Linear guide friction exceeds configured threshold.",
            }
        )

    if straightness_error_mm >= alerts_config["high_straightness_error_mm"]:
        alerts.append(
            {
                "severity": "WARNING",
                "code": "HIGH_STRAIGHTNESS_ERROR",
                "message": "Linear guide straightness error exceeds configured threshold.",
            }
        )

    if carriage_drag_factor >= alerts_config["high_carriage_drag_factor"]:
        alerts.append(
            {
                "severity": "CRITICAL",
                "code": "HIGH_CARRIAGE_DRAG",
                "message": "Recoating carriage drag exceeds configured threshold.",
            }
        )

    if status == "FAILED":
        alerts.append(
            {
                "severity": "CRITICAL",
                "code": "COMPONENT_FAILED",
                "message": "Linear guide health is below the failure threshold.",
            }
        )

    return alerts


def calculate_linear_guide_state(
    previous_state: dict,
    drivers: dict,
    config: dict,
) -> dict:
    """Calculate deterministic rail wear, friction, and alignment drift.

    @param previous_state: Previous linear guide state or wrapped machine state.
    @param drivers: Normalized operating drivers for the current simulation step.
    @param config: Phase 1 model configuration.
    @return: Component state containing health, status, damage, metrics, and alerts.
    """
    component_config = get_component_config(config, COMPONENT_NAME)
    health_config = component_config["health"]
    calibration_config = component_config["calibration"]
    sensitivity = component_config["sensitivity"]
    physical_properties = component_config["physical_properties"]
    alerts_config = component_config["alerts"]

    previous_health = clamp(
        float(get_previous_health(previous_state, COMPONENT_NAME, health_config)),
        health_config["min"],
        health_config["max"],
    )

    drivers = drivers or {}

    operational_load = max(float(drivers.get("operational_load", 0.0)), 0.0)
    contamination = clamp(float(drivers.get("contamination", 0.0)), 0.0, 1.0)
    humidity = clamp(float(drivers.get("humidity", 0.0)), 0.0, 1.0)
    maintenance_level = clamp(float(drivers.get("maintenance_level", 0.0)), 0.0, 1.0)

    base_damage_per_cycle = (
        health_config["initial"] - calibration_config["failure_threshold"]
    ) / calibration_config["target_cycles_until_failure"]

    contamination_factor = 1.0 + sensitivity["contamination"] * contamination
    humidity_factor = 1.0 + sensitivity["humidity"] * humidity
    maintenance_factor = 1.0 - sensitivity["maintenance_protection"] * maintenance_level

    raw_damage = (
        base_damage_per_cycle
        * operational_load ** sensitivity["load_exponent"]
        * contamination_factor
        * humidity_factor
        * maintenance_factor
    )

    damage = clamp(raw_damage, 0.0, previous_health - health_config["min"])
    new_health = clamp(
        previous_health - damage,
        health_config["min"],
        health_config["max"],
    )

    rounded_health = round(new_health, HEALTH_PRECISION)
    rounded_health = snap_health_to_failure_threshold(rounded_health, health_config)
    reported_damage = get_reported_damage(previous_health, rounded_health)
    status = get_status_from_health(rounded_health, health_config)

    degradation_ratio = 1.0 - rounded_health

    friction_coefficient = (
        physical_properties["nominal_friction_coefficient"]
        + physical_properties["max_friction_increase"] * degradation_ratio
    )
    straightness_error_mm = (
        physical_properties["max_straightness_error_mm"] * degradation_ratio
    )
    carriage_drag_factor = (
        1.0 + physical_properties["max_carriage_drag_increase"] * degradation_ratio
    )
    alignment_score = clamp(1.0 - degradation_ratio, 0.0, 1.0)

    pressures = {
        "rail_wear": 1.0,
        "contamination_scoring": sensitivity["contamination"] * contamination,
        "humidity_corrosion": sensitivity["humidity"] * humidity,
    }
    damage_breakdown = {"total": reported_damage}
    damage_breakdown.update(split_damage_by_pressure(reported_damage, pressures))

    rounded_friction = round(friction_coefficient, 6)
    rounded_straightness = round(straightness_error_mm, 6)
    rounded_drag = round(carriage_drag_factor, 6)

    return {
        "subsystem": component_config["subsystem"],
        "component": COMPONENT_NAME,
        "health": rounded_health,
        "status": status,
        "damage": damage_breakdown,
        "metrics": {
            "friction_coefficient": rounded_friction,
            "straightness_error_mm": rounded_straightness,
            "carriage_drag_factor": rounded_drag,
            "alignment_score": round(alignment_score, 6),
            "contamination_factor": round(contamination_factor, 6),
            "humidity_factor": round(humidity_factor, 6),
            "maintenance_factor": round(maintenance_factor, 6),
        },
        "alerts": _build_alerts(
            status,
            rounded_friction,
            rounded_straightness,
            rounded_drag,
            alerts_config,
        ),
    }
