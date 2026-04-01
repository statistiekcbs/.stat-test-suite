/******************
	This test provies scenario for load testing a NSI-WS:
		1.- Assess the current performance of the NSI-WS under typical and peak load.
		2.- Make sure that the NSI-WS is continuously meeting the performance standards as changes are made to the system (code and infrastructure).
	
*******************/
import http from "k6/http";

import {
  TryToGetNewAccessToken,
  initConfig,
  getAllDataflows,
  getAllStructures,
  getSizeTag,
  shuffle,
  cartesianProduct,
} from "./resources/utils.js";

const SAMPLE_RATE = Number(__ENV.SAMPLE_RATE || "100") / 100;

const WEIGHTS = JSON.parse(open("./resources/weights.json"));

const TESTSET = __ENV.TESTSET_FILE
  ? JSON.parse(open(__ENV.TESTSET_FILE)).testSet
  : null;

// get all data combinations
const DATA_COMBINATIONS = cartesianProduct([
  Object.keys(WEIGHTS.data.format),
  Object.keys(WEIGHTS.data.filter),
  Object.keys(WEIGHTS.data.range),
]).map(([format, filter, range]) => ({
  format,
  filter,
  range,
}));

// get all availableconstriant combinations
const AVAIL_COMBINATIONS = cartesianProduct([
  Object.keys(WEIGHTS.availableconstraint.format),
  Object.keys(WEIGHTS.availableconstraint.filter),
  Object.keys(WEIGHTS.availableconstraint.mode),
]).map(([format, filter, mode]) => ({
  format,
  filter,
  mode,
}));

// get all data combinations
const STRUCT_COMBINATIONS = cartesianProduct([
  Object.keys(WEIGHTS.structure.resource),
  Object.keys(WEIGHTS.structure.type),
  Object.keys(WEIGHTS.structure.format),
  Object.keys(WEIGHTS.structure.detail),
  Object.keys(WEIGHTS.structure.references),
]).map(([resource, type, format, detail, references]) => ({
  resource,
  type,
  format,
  detail,
  references,
}));

export let options = {
  // systemTags: ["check", "error_code", "group", "method", "name", "status"],
  scenarios: {
    smoke: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      maxDuration: "60m",
    },
  },
  thresholds: {
    "http_req_failed{scenario:smoke}": ["rate<0.01"], // more than 99% success rate
  },
  //Discard the response bodies to lessen the amount of memmory required by the testing machine.
  discardResponseBodies: true,
};

export function setup() {
  let config = initConfig(true);
  if (!TESTSET) {
    getAllDataflows(config);
    getAllStructures(config, WEIGHTS);
  }
  return config;
}

export default function (config) {
  let params = {
    headers: {
      "Accept-Encoding": "gzip, deflate",
    },
    timeout: __ENV.QUERY_TIMEOUT || "60s",
    tags: {
      type: "data",
    },
  };

  let testSet = TESTSET?.datasets || config.datasets;
  shuffle(testSet);

  const iterations = Math.max(Math.ceil(SAMPLE_RATE * testSet.length), 1);

  const datasets = testSet.slice(0, iterations);

  // test data queries
  // set expected result
  http.setResponseCallback(http.expectedStatuses(200, 206));

  for (let dataset of datasets) {
    DATA_COMBINATIONS.forEach((s) => {
      // pick format
      const formatKey = s.format;
      params.headers.Accept = WEIGHTS.data.format[formatKey].header;
      params.tags.format = formatKey;

      // pick filter
      const filterKey = s.filter;
      const filter = filterKey === "default" ? dataset.defaultFilter : "";
      params.tags.filter = filterKey;

      // set data size tag
      params.tags.dataSize = getSizeTag(
        filterKey === "default"
          ? dataset.filteredObsCount
          : dataset.unfilteredObsCount
      );

      // pick range
      const rangeKey = s.range;
      params.headers.Range = WEIGHTS.data.range[rangeKey].header;
      params.tags.range = rangeKey;

      // create URL
      const url = http.url`${config.nsiScheme}://${config.nsiHostname}:${config.nsiPort}/rest/data/${dataset.dataflow}/${filter}`;

      // get auth token
      TryToGetNewAccessToken(config);
      params.headers.Authorization = `Bearer ${config.accessToken}`;

      // make the call: https://www.youtube.com/watch?v=THhL8VVtQAU
      http.get(url, params);
    });
  }

  // test availableconstraint queries
  // reset params
  params.headers = { "Accept-Encoding": "gzip, deflate" };
  params.tags = {
    type: "availableconstraint",
  };

  // set expected result
  http.setResponseCallback(http.expectedStatuses(200));

  for (let dataset of datasets) {
    AVAIL_COMBINATIONS.forEach((s) => {
      // pick format
      const formatKey = s.format;
      params.headers.Accept =
        WEIGHTS.availableconstraint.format[formatKey].header;
      params.tags.format = formatKey;

      // pick filter
      const filterKey = s.filter;
      const filter = filterKey === "default" ? dataset.defaultFilter : "";
      params.tags.filter = filterKey;

      // pick mode
      const modeKey = s.mode;
      params.tags.mode = modeKey;

      // create URL
      const querySeperator = filter.includes("?") ? "&" : "?";
      const url = http.url`${config.nsiScheme}://${config.nsiHostname}:${config.nsiPort}/rest/availableconstraint/${dataset.dataflow}/${filter}${querySeperator}mode=${modeKey}`;

      // get auth token
      TryToGetNewAccessToken(config);
      params.headers.Authorization = `Bearer ${config.accessToken}`;

      // make the call: https://www.youtube.com/watch?v=THhL8VVtQAU
      const res = http.get(url, params);
      console.log(res);
    });
  }

  // test structure queries
  // reset params
  params.headers = { "Accept-Encoding": "gzip, deflate" };
  params.tags = {
    type: "structure",
  };

  // set expected result
  http.setResponseCallback(http.expectedStatuses(200));

  STRUCT_COMBINATIONS.forEach((s) => {
    // pick structure type
    const structTypeKey = s.type;
    params.tags.structure = structTypeKey;

    // pick resource or all
    let { agencyID, id, version } = {
      agencyID: "all",
      id: "all",
      version: "all",
    };

    const resourceKey = s.resource;
    const testSet = TESTSET || config;

    if (resourceKey === "specific") {
      const structure =
        testSet[structTypeKey][
          Math.floor(Math.random() * testSet[structTypeKey].length)
        ];
      ({ agencyID, id, version } = structure);
    }
    params.tags.resource = resourceKey;

    // pick detail level
    const detailKey = s.detail;
    params.tags.detail = detailKey;

    // pick references
    const referencesKey = s.references;
    params.tags.references = referencesKey;

    // pick format
    const formatKey = s.format;
    params.headers.Accept = WEIGHTS.structure.format[formatKey].header;
    params.tags.format = formatKey;

    // create URL
    const url = http.url`${config.nsiScheme}://${config.nsiHostname}:${config.nsiPort}/rest/${structTypeKey}/${agencyID}/${id}/${version}?detail=${detailKey}&references=${referencesKey}`;

    // get auth token
    TryToGetNewAccessToken(config);
    params.headers.Authorization = `Bearer ${config.accessToken}`;

    // make the call: https://www.youtube.com/watch?v=THhL8VVtQAU
    http.get(url, params);
  });
}

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
