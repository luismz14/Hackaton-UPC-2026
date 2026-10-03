"""Thermal Firing Resistors degradation model for the printhead array."""

import math

from .common import (
    HEALTH_PRECISION,
    clamp,
    get_component_config,
    get_component_health,
    get_previous_health,
    get_reported_damage,
    get_status_from_health,
    snap_health_to_failure_threshold,
    split_damage_by_pressure,
)


COMPONENT_NAME = "thermal_firing_resistors"


def _build_alerts(status, resistance_ohm, pulse_uniformity, misfire_risk, alerts_config):
    """Build threshold alerts for firing resistor electrical instability.

    @param status: Component status after the current degradation step.
    @param resistance_ohm: Current estimated electrical resistance.
    @param pulse_uniformity: Current normalized pulse uniformity.
    @param misfire_risk: Current normalized misfire risk.
    @param alerts_config: Alert thresholds from the component configuration.
    @return: Alert dictionaries describing threshold breaches.
    """
    alerts = []

    if resistance_ohm >= alerts_config["high_resistance_threshold_ohm"]:
        alerts.append(
            {
                "severity": "WARNING",
                "code": "HIGH_RESISTANCE",
                "message": "Thermal firing resistor resistance exceeds threshold.",
            }
        )

    if pulse_uniformity <= alerts_config["low_pulse_uniformity_threshold"]:
        alerts.append(
            {
                "severity": "WARNING",
                "code": "LOW_PULSE_UNIFORMITY",
                "message": "Thermal firing resistor pulse uniformity is below threshold.",
            }
        )

    if misfire_risk >= alerts_config["high_misfire_risk_threshold"]:
        alerts.append(
            {
                "severity": "CRITICAL",
                "code": "HIGH_MISFIRE_RISK",
                "message": "Thermal firing resistor misfire risk exceeds threshold.",
            }
        )

    if status == "FAILED":
        alerts.append(
            {
                "severity": "CRITICAL",
                "code": "COMPONENT_FAILED",
                "message": "Thermal firing resistors health is below the failure threshold.",
            }
        )

    return alerts


def calculate_thermal_firing_resistors_state(
    previous_state: dict,
    drivers: dict,
    config: dict,
    heating_elements_state: dict | None = None,
) -> dict:
    """Calculate deterministic electrical and thermal fatigue of firing resistors.

    @param previous_state: Previous firing resistor state or wrapped machine state.
    @param drivers: Normalized operating drivers for the current simulation step.
    @param config: Phase 1 model configuration.
    @param heating_elements_state: Upstream heating state used for thermal cascade.
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
    temperature_stress = clamp(float(drivers.get("temperature_stress", 0.0)), 0.0, 1.0)
    maintenance_level = clamp(float(drivers.get("maintenance_level", 0.0)), 0.0, 1.0)

    heating_elements_health = get_component_health(heating_elements_state)
    heating_degradation = 1.0 - heating_elements_health
    effective_temperature_stress = clamp(
        temperature_stress + sensitivity["heating_cascade"] * heating_degradation,
        0.0,
        1.0,
    )

    initial_health = health_config["initial"]
    failure_threshold = calibration_config["failure_threshold"]
    target_cycles_until_failure = calibration_config["target_cycles_until_failure"]
    decay_lambda = -math.log(failure_threshold / initial_health) / target_cycles_until_failure

    load_factor = operational_load ** sensitivity["load_exponent"]
    temperature_factor = (
        1.0 + sensitivity["temperature_stress"] * effective_temperature_stress
    )
    humidity_factor = 1.0 + sensitivity["humidity"] * humidity
    contamination_factor = 1.0 + sensitivity["contamination"] * contamination
    maintenance_factor = 1.0 - sensitivity["maintenance_protection"] * maintenance_level

    effective_load = (
        load_factor
        * temperature_factor
        * humidity_factor
        * contamination_factor
        * maintenance_factor
    )

    raw_damage = previous_health * (1.0 - math.exp(-decay_lambda * effective_load))
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

    resistance_ohm = physical_properties["nominal_resistance_ohm"] * (
        1.0 + physical_properties["max_resistance_increase_pct"] * degradation_ratio
    )
    firing_energy_factor = (
        1.0 + physical_properties["max_firing_energy_overhead"] * degradation_ratio
    )
    pulse_uniformity = clamp(
        1.0 - physical_properties["max_pulse_uniformity_loss"] * degradation_ratio,
        0.0,
        1.0,
    )
    misfire_risk = clamp(
        physical_properties["max_misfire_risk"]
        * degradation_ratio
        * (1.0 + effective_temperature_stress),
        0.0,
        physical_properties["max_misfire_risk"] * 2.0,
    )

    pressures = {
        "electrical_fatigue": 1.0,
        "thermal_fatigue": sensitivity["temperature_stress"]
        * effective_temperature_stress,
        "humidity_stress": sensitivity["humidity"] * humidity,
        "contamination_deposits": sensitivity["contamination"] * contamination,
    }
    damage_breakdown = {"total": reported_damage}
    damage_breakdown.update(split_damage_by_pressure(reported_damage, pressures))

    rounded_resistance = round(resistance_ohm, 6)
    rounded_uniformity = round(pulse_uniformity, 6)
    rounded_misfire = round(misfire_risk, 6)

    return {
        "subsystem": component_config["subsystem"],
        "component": COMPONENT_NAME,
        "health": rounded_health,
        "status": status,
        "damage": damage_breakdown,
        "metrics": {
            "resistance_ohm": rounded_resistance,
            "firing_energy_factor": round(firing_energy_factor, 6),
            "pulse_uniformity": rounded_uniformity,
            "misfire_risk": rounded_misfire,
            "effective_temperature_stress": round(effective_temperature_stress, 6),
            "heating_elements_health": round(heating_elements_health, 6),
            "temperature_factor": round(temperature_factor, 6),
            "humidity_factor": round(humidity_factor, 6),
            "contamination_factor": round(contamination_factor, 6),
            "maintenance_factor": round(maintenance_factor, 6),
            "effective_load": round(effective_load, 6),
            "decay_lambda": round(decay_lambda, 10),
        },
        "alerts": _build_alerts(
            status,
            rounded_resistance,
            rounded_uniformity,
            rounded_misfire,
            alerts_config,
        ),
    }
