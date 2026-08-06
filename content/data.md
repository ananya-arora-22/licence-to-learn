+++
title = "Data so far"
description = "Machine-readable data built from RTI responses. Software, the institutions that use it, and what it costs."
+++

{{ filter_tabs(controls="spend-cards software-cards") }}

{{ spend_counter(csv="data/costs.csv") }}

## Spend by institute

Yearly software expenditure reported by each responding institute. Hover or focus a point to see the amount.

{{ spend_cards(csv="data/costs.csv") }}

{{ software_cards(csv="data/software.csv") }}

## Software dependencies mapped

{{ data_table(csv="data/software.csv", schema="data/software.schema.json", caption="Stack as reported by NITs. Coming up next: IIMs, IIITs and AIIMS.") }}

## Total costs

{{ data_table(csv="data/costs.csv", schema="data/costs.schema.json", caption="Reported annual software expenditure per institution.") }}
