"""Pydantic response models for the Untitled Jam API."""

from typing import Literal

from pydantic import BaseModel, Field


class ServiceInfo(BaseModel):
    """Describes the application service exposed by this process."""

    name: str = Field(default="Untitled Jam")
    version: str = Field(default="0.1.0")
    framework: Literal["FastAPI"] = "FastAPI"


class HealthResponse(BaseModel):
    """Typed response returned by the health endpoint."""

    status: Literal["ok"] = "ok"
    service: ServiceInfo = Field(default_factory=ServiceInfo)
