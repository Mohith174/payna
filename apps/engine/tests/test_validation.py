"""Schema validation + category mapping + tolerant JSON extraction."""

from __future__ import annotations

import pytest

from payna_engine.agents.validation_agent import _category_for
from payna_engine.domain import ExtractedRequirement
from payna_engine.llm import extract_first_json_array


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Money Transmitter License", "Money Services"),
        ("Currency Exchange License", "Money Services"),
        ("Consumer Lending License", "Lending"),
        ("Mortgage Broker License", "Lending"),
        ("Supervised Lender License", "Lending"),
        ("Consumer Finance License", "Lending"),
        ("Debt Collection License", "Collections"),
        ("Collection Agency License", "Collections"),
    ],
)
def test_category_mapping(name, expected):
    assert _category_for(name) == expected


def test_valid_record_parses_with_aliases():
    rec = ExtractedRequirement.model_validate(
        {
            "name": "Annual Report",
            "description": "Yearly filing.",
            "stateCode": "ca",
            "licenseTypeName": "Money Transmitter License",
            "intervalMonths": 12,
            "dueMonthDay": "03-31",
            "dependsOnNames": [],
            "confidence": 0.9,
        }
    )
    assert rec.state_code == "CA"  # normalized upper
    assert rec.interval_months == 12


def test_unknown_state_rejected():
    with pytest.raises(Exception):
        ExtractedRequirement.model_validate(
            {"name": "X", "description": "Y", "stateCode": "ZZ", "licenseTypeName": "L"}
        )


def test_bad_month_day_rejected():
    with pytest.raises(Exception):
        ExtractedRequirement.model_validate(
            {"name": "X", "description": "Y", "stateCode": "CA", "licenseTypeName": "L", "dueMonthDay": "13-40"}
        )


def test_extract_first_json_array_ignores_prose_and_fences():
    text = 'Here is the result:\n```json\n[{"a": 1}, {"b": "]"}]\n```\nDone.'
    assert extract_first_json_array(text) == '[{"a": 1}, {"b": "]"}]'
