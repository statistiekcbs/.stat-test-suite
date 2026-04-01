/******************
    This test provies scenario for load testing a NSI-WS:
        1.- Assess the current performance of the NSI-WS under typical and peak load.
        2.- Make sure that the NSI-WS is continuously meeting the performance standards as changes are made to the system (code and infrastructure).
    
*******************/
import http from "k6/http";
import {
  initConfig,
  cartesianProduct,
  TryToGetNewAccessToken,
} from "./resources/utils.js";
import { SharedArray } from "k6/data";
import { scenario } from "k6/execution";

const WEIGHTS = JSON.parse(open("./resources/weights.json"));

const PREALLOCATED_VUS = Number(__ENV.PREALLOCATED_VUS || "1");

const MAX_DURATION = __ENV.MAX_DURATION || "60m";

const QUERY_TIMEOUT = __ENV.QUERY_TIMEOUT || "60s";

const AGENCY_FILTER = __ENV.AGENCY_FILTER || null;

function getHighestWeightProperties(obj) {
  // const maxWeight = Math.max(...Object.values(obj).map((item) => item.weight));
  // return Object.keys(obj).filter((key) => obj[key].weight === maxWeight);
  return Object.keys(obj);
}

const MAX_TYPES = getHighestWeightProperties(WEIGHTS.structure.type);

// Load test data into ShareArrays from json input if provided
function getTestInputArray(key) {
  return JSON.parse(open(__ENV.TESTSET_FILE)).setup_data[key];
}

const TESTSET = {
  ...Object.fromEntries(
    MAX_TYPES.map((key) => [
      key,
      new SharedArray(key, () => {
        const parsedData = getTestInputArray(key);
        return AGENCY_FILTER
          ? parsedData.filter((x) => x.agencyID === AGENCY_FILTER)
          : parsedData;
      }),
    ])
  ),
};

// get all data combinations
const STRUCT_COMBINATIONS = cartesianProduct([
  getHighestWeightProperties(WEIGHTS.structure.format),
  getHighestWeightProperties(WEIGHTS.structure.detail),
  getHighestWeightProperties(WEIGHTS.structure.references),
]).map(([format, detail, references]) => ({
  format,
  detail,
  references,
}));

export let options = {
  // systemTags: ["check", "error_code", "group", "method", "name", "status"],
  scenarios: {
    "pre-heat": {
      executor: "shared-iterations",
      vus: PREALLOCATED_VUS,
      iterations: MAX_TYPES.reduce(
        (sum, ressourceType) => sum + TESTSET[ressourceType].length,
        0
      ),
      maxDuration: MAX_DURATION,
    },
  },
  //Discard the response bodies to lessen the amount of memmory required by the testing machine.
  discardResponseBodies: true,
};

export function setup() {
  let config = initConfig(true);

  config.params = {
    headers: {
      "Accept-Encoding": "gzip, deflate",
    },
    timeout: QUERY_TIMEOUT,
  };

  return config;
}

export default function (config) {
  let params = config.params;
  // Get a new token to perform the call
  TryToGetNewAccessToken(config);
  // Set authorization if provided
  if (config.accessToken) {
    params.headers.Authorization = `Bearer ${config.accessToken}`;
  }

  let ressource;
  let type;
  let iteration_number = scenario.iterationInTest + 1;
  for (const ressourceType of MAX_TYPES) {
    iteration_number -= TESTSET[ressourceType].length;
    if (iteration_number <= 0) {
      ressource = TESTSET[ressourceType][iteration_number * -1];
      type = ressourceType;
      break;
    }
  }

  const { agencyID, id, version } = ressource;

  http.batch(
    STRUCT_COMBINATIONS.map((s) => {
      params.headers.Accept = WEIGHTS.structure.format[s.format].header;
      return [
        "GET",
        http.url`${config.nsiScheme}://${config.nsiHostname}:${config.nsiPort}/rest/${type}/${agencyID}/${id}/${version}?references=${s.references}&detail=${s.detail}`,
        null,
        params,
      ];
    })
  );
}
