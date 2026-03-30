/******************
	This test provies scenario for load testing a NSI-WS:
		1.- Assess the current performance of the NSI-WS under typical and peak load.
		2.- Make sure that the NSI-WS is continuously meeting the performance standards as changes are made to the system (code and infrastructure).
	
*******************/
import http from "k6/http";
import { SharedArray } from "k6/data";
import { textSummary } from "./resources/k6-summary_0.1.0.js";
import { tagWithCurrentStageProfile } from "./resources/k6-utils_1.6.0/index.js";

import {
  TryToGetNewAccessToken,
  initConfig,
  getAllDataflows,
  getAllStructures,
  getSizeTag,
  calculateCDF,
  getWeightedKey,
} from "./resources/utils.js";
import { test } from "k6/execution";

// Set global variables
const PREALLOCATED_VUS = Number(__ENV.PREALLOCATED_VUS || "150");

const QUERY_TIMEOUT = __ENV.QUERY_TIMEOUT || "60s";

const GRACEFUL_STOP = __ENV.GRACEFUL_STOP || QUERY_TIMEOUT;

const LOAD_RATE = Number(__ENV.LOAD_RATE || "50");

const LOAD_DURATION = __ENV.LOAD_DURATION || "15m";

const LOAD_RAMPUP = __ENV.LOAD_RAMPUP || "60s";

const LOAD_RAMPDOWN = __ENV.LOAD_RAMPDOWN || "60s";

const EMPTY_STATUS_CODE = Number(__ENV.EMPTY_STATUS_CODE || "404");

const AGENCY_FILTER = __ENV.AGENCY_FILTER || null;

const WEIGHTS = JSON.parse(open("./resources/weights.json"));

const THRESHOLDS = JSON.parse(open("./resources/thresholds.json"));

const TYPE_WEIGHT_TOTAL = Object.keys(WEIGHTS).reduce(
  (sum, k) => sum + (WEIGHTS[k].weight || 0),
  0
);

// Calculate cumulative distribution functions
const DATA_CDFS = Object.fromEntries(
  Object.entries(WEIGHTS.data).map(([key, value]) => [key, calculateCDF(value)])
);

const AVAIL_CDFS = Object.fromEntries(
  Object.entries(WEIGHTS.availableconstraint).map(([key, value]) => [
    key,
    calculateCDF(value),
  ])
);

const STRUCT_CDFS = Object.fromEntries(
  Object.entries(WEIGHTS.structure).map(([key, value]) => [
    key,
    calculateCDF(value),
  ])
);

// Load test data into ShareArrays from json input if provided
function getTestInputArray(key) {
  return JSON.parse(open(__ENV.TESTSET_FILE)).setup_data[key];
}

const TESTSET = __ENV.TESTSET_FILE
  ? {
      ...Object.fromEntries(
        Object.keys(WEIGHTS.structure.type).map((key) => [
          key,
          new SharedArray(key, () => {
            const parsedData = getTestInputArray(key);
            return AGENCY_FILTER
              ? parsedData.filter((x) => x.agencyID === AGENCY_FILTER)
              : parsedData;
          }),
        ])
      ),
      datasets: new SharedArray("datasets", () => {
        const parsedData = getTestInputArray("datasets");
        return AGENCY_FILTER
          ? parsedData.filter((x) => x.dataflow.startsWith(AGENCY_FILTER))
          : parsedData;
      }),
    }
  : null;

export let options = {
  // Load is distributed over 3 scenarios: data, available constraints and structures
  scenarios: {
    data: {
      executor: "ramping-arrival-rate",
      // Start iterations per `timeUnit`
      startRate: 0,
      // Start `startRate` iterations per minute
      timeUnit: "1s",
      // Pre-allocate necessary VUs.
      preAllocatedVUs: Math.floor(
        (PREALLOCATED_VUS * WEIGHTS.data.weight) / TYPE_WEIGHT_TOTAL
      ),
      // Function to run
      exec: "data",
      stages: [
        // Get to LOAD_RATE in LOAD_RAMPUP time
        {
          target: Math.floor(
            (LOAD_RATE * WEIGHTS.data.weight) / TYPE_WEIGHT_TOTAL
          ),
          duration: LOAD_RAMPUP,
        },
        // Hold LOAD_RATE for LOAD_DURATION
        {
          target: Math.floor(
            (LOAD_RATE * WEIGHTS.data.weight) / TYPE_WEIGHT_TOTAL
          ),
          duration: LOAD_DURATION,
        },
        // Get back to 0 RPS in LOAD_RAMPDOWN time
        { target: 0, duration: LOAD_RAMPDOWN },
      ],
      // Time to wait at the end for the last queries to finish
      gracefulStop: GRACEFUL_STOP,
    },
    availableconstraint: {
      executor: "ramping-arrival-rate",
      // Start iterations per `timeUnit`
      startRate: 0,
      // Start `startRate` iterations per minute
      timeUnit: "1s",
      // Pre-allocate necessary VUs.
      preAllocatedVUs: Math.floor(
        (PREALLOCATED_VUS * WEIGHTS.availableconstraint.weight) /
          TYPE_WEIGHT_TOTAL
      ),
      // Function to run
      exec: "availableconstraint",
      stages: [
        // Get to LOAD_RATE in LOAD_RAMPUP time
        {
          target: Math.floor(
            (LOAD_RATE * WEIGHTS.availableconstraint.weight) / TYPE_WEIGHT_TOTAL
          ),
          duration: LOAD_RAMPUP,
        },
        // Hold LOAD_RATE for LOAD_DURATION
        {
          target: Math.floor(
            (LOAD_RATE * WEIGHTS.availableconstraint.weight) / TYPE_WEIGHT_TOTAL
          ),
          duration: LOAD_DURATION,
        },
        // Get back to 0 RPS in LOAD_RAMPDOWN time
        { target: 0, duration: LOAD_RAMPDOWN },
      ],
      // Time to wait at the end for the last queries to finish
      gracefulStop: GRACEFUL_STOP,
    },
    structure: {
      executor: "ramping-arrival-rate",
      // Start iterations per `timeUnit`
      startRate: 0,
      // Start `startRate` iterations per minute
      timeUnit: "1s",
      // Pre-allocate necessary VUs.
      preAllocatedVUs: Math.floor(
        (PREALLOCATED_VUS * WEIGHTS.structure.weight) / TYPE_WEIGHT_TOTAL
      ),
      // Function to run
      exec: "structure",
      stages: [
        // Get to LOAD_RATE in LOAD_RAMPUP time
        {
          target: Math.floor(
            (LOAD_RATE * WEIGHTS.structure.weight) / TYPE_WEIGHT_TOTAL
          ),
          duration: LOAD_RAMPUP,
        },
        // Hold LOAD_RATE for LOAD_DURATION
        {
          target: Math.floor(
            (LOAD_RATE * WEIGHTS.structure.weight) / TYPE_WEIGHT_TOTAL
          ),
          duration: LOAD_DURATION,
        },
        // Get back to 0 RPS in LOAD_RAMPDOWN time
        { target: 0, duration: LOAD_RAMPDOWN },
      ],
      // Time to wait at the end for the last queries to finish
      gracefulStop: GRACEFUL_STOP,
    },
  },
  thresholds: THRESHOLDS,

  //Discard the response bodies to lessen the amount of memmory required by the testing machine.
  discardResponseBodies: true,
};

// Initialize config, generate test data if not provided and common query parameters
export function setup() {
  let config = initConfig(true);
  if (!TESTSET) {
    getAllDataflows(config);
    getAllStructures(config, WEIGHTS);
  }
  config.params = {
    headers: {
      "Accept-Encoding": "gzip, deflate",
    },
    timeout: QUERY_TIMEOUT,
    tags: {},
  };
  return config;
}

export function data(config) {
  tagWithCurrentStageProfile();
  // Get a new token to perform the call
  TryToGetNewAccessToken(config);
  // Set query type tag
  let params = config.params;
  params.tags.type = "data";
  // Set authorization if provided
  if (config.accessToken) {
    params.headers.Authorization = `Bearer ${config.accessToken}`;
  }
  // Get the test datasets
  const testSet = TESTSET?.datasets || config.datasets;
  // Select a random dataset
  const dataset = testSet[Math.floor(Math.random() * testSet.length)];
  // Choose a format
  const formatKey = getWeightedKey(DATA_CDFS.format);
  params.headers.Accept = WEIGHTS.data.format[formatKey].header;
  params.tags.format = formatKey;
  // Choose a filter
  const filterKey = getWeightedKey(DATA_CDFS.filter);
  const filter = filterKey === "default" ? dataset.defaultFilter : "";
  params.tags.filter = filterKey;
  // Set the size tag
  params.tags.dataSize = getSizeTag(
    filterKey === "default"
      ? dataset.filteredObsCount
      : dataset.unfilteredObsCount
  );
  // Choose a range
  const rangeKey = getWeightedKey(DATA_CDFS.range);
  params.headers["X-Range"] = WEIGHTS.data.range[rangeKey].header;
  params.tags.range = rangeKey;
  // Choose dimensionAtObservation (dao)
  const daoKey = getWeightedKey(AVAIL_CDFS.dimensionAtObservation);
  params.tags.dao = daoKey;
  // Set the expected response status
  http.setResponseCallback(
    params.tags.dataSize === "empty"
      ? http.expectedStatuses(EMPTY_STATUS_CODE)
      : http.expectedStatuses(200, 206)
  );
  // Generate the URL
  const url = http.url`${config.nsiScheme}://${config.nsiHostname}:${
    config.nsiPort
  }/rest/data/${dataset.dataflow}/${filter}${
    filter.includes("?") ? "&" : "?"
  }dimensionAtObservation=${daoKey}`;
  // Perform the call
  http.get(url, params);
}

export function availableconstraint(config) {
  tagWithCurrentStageProfile();
  // Get a new token to perform the call
  TryToGetNewAccessToken(config);
  // Set query type tag
  let params = config.params;
  params.tags.type = "availableconstraint";
  if (config.accessToken) {
    params.headers.Authorization = `Bearer ${config.accessToken}`;
  }
  // Get the test datasets
  const testSet = TESTSET?.datasets || config.datasets;
  // Select a random dataset
  const dataset = testSet[Math.floor(Math.random() * testSet.length)];
  // Choose a format
  const formatKey = getWeightedKey(AVAIL_CDFS.format);
  params.headers.Accept = WEIGHTS.availableconstraint.format[formatKey].header;
  params.tags.format = formatKey;
  // Choose a filter
  const filterKey = getWeightedKey(AVAIL_CDFS.filter);
  const filter = filterKey === "default" ? dataset.defaultFilter : "";
  params.tags.filter = filterKey;
  // Set the size tag
  params.tags.dataSize = getSizeTag(
    filterKey === "default"
      ? dataset.filteredObsCount
      : dataset.unfilteredObsCount
  );
  // Choose a mode
  const modeKey = getWeightedKey(AVAIL_CDFS.mode);
  params.tags.mode = modeKey;
  // Choose dimensionAtObservation (dao)
  const daoKey = getWeightedKey(AVAIL_CDFS.dimensionAtObservation);
  params.tags.dao = daoKey;
  // Set the expected response status
  http.setResponseCallback(http.expectedStatuses(200));
  // Generate the URL
  const url = http.url`${config.nsiScheme}://${config.nsiHostname}:${
    config.nsiPort
  }/rest/availableconstraint/${dataset.dataflow}/${filter}${
    filter.includes("?") ? "&" : "?"
  }dimensionAtObservation=${daoKey}&mode=${modeKey}`;
  // Perform the call
  http.get(url, params);
}

export function structure(config) {
  tagWithCurrentStageProfile();
  // Get a new token to perform the call
  TryToGetNewAccessToken(config);
  // Set query type tag
  let params = config.params;
  params.tags.type = "structure";
  // Set authorization if provided
  if (config.accessToken) {
    params.headers.Authorization = `Bearer ${config.accessToken}`;
  }
  // Choose a structure type
  const structTypeKey = getWeightedKey(STRUCT_CDFS.type);
  params.tags.structure = structTypeKey;
  // Initialize structure call ressource
  let { agencyID, id, version } = {
    agencyID: AGENCY_FILTER || "all",
    id: "all",
    version: "all",
  };
  // Choose between "all" and a specific structure to query
  const resourceKey = getWeightedKey(STRUCT_CDFS.resource);
  params.tags.resource = resourceKey;
  // If querying for a specific strucutre, randomly choose one
  if (resourceKey === "specific") {
    // Get the test datasets
    const testSet = TESTSET || config;
    const structureSet = testSet[structTypeKey];
    // Choose a structure
    const structure =
      structureSet[Math.floor(Math.random() * structureSet.length)];
    ({ agencyID, id, version } = structure);
  }
  // Choose a detail level
  const detailKey = getWeightedKey(STRUCT_CDFS.detail);
  params.tags.detail = detailKey;
  // Choose references parameter
  const referencesKey = getWeightedKey(STRUCT_CDFS.references);
  params.tags.references = referencesKey;
  // Choose a format
  const formatKey = getWeightedKey(STRUCT_CDFS.format);
  params.headers.Accept = WEIGHTS.structure.format[formatKey].header;
  params.tags.format = formatKey;
  // Set the expected response status
  http.setResponseCallback(http.expectedStatuses(200));
  // Generate the URL
  const url = http.url`${config.nsiScheme}://${config.nsiHostname}:${config.nsiPort}/rest/${structTypeKey}/${agencyID}/${id}/${version}?detail=${detailKey}&references=${referencesKey}`;
  // Perform the call
  http.get(url, params);
}

// Generate the summary. If the path is provided, render a json summary
export function handleSummary(data) {
  delete data.setup_data.password;
  let out = {
    stdout: textSummary(data),
  };
  if (__ENV.JSON_SUMMARY) {
    out[__ENV.JSON_SUMMARY] = JSON.stringify(data);
  }
  return out;
}
