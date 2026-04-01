/******************
    This test provies scenario for load testing a NSI-WS:
        1.- Assess the current performance of the NSI-WS under typical and peak load.
        2.- Make sure that the NSI-WS is continuously meeting the performance standards as changes are made to the system (code and infrastructure).
    
*******************/
import {
  initConfig,
  getAllDataflows,
  getAllStructures,
} from "./resources/utils.js";

const WEIGHTS = JSON.parse(open("./resources/weights.json"));

const TEST_INPUT = __ENV.TEST_INPUT || "test_input.json";

export let options = {
  // systemTags: ["check", "error_code", "group", "method", "name", "status"],
  scenarios: {
    init: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      maxDuration: "1s",
    },
  },
  //Discard the response bodies to lessen the amount of memmory required by the testing machine.
  discardResponseBodies: true,
};

export function setup() {
  let config = initConfig(true);
  getAllDataflows(config);
  getAllStructures(config, WEIGHTS);
  return config;
}

export default function (data) {}

export function handleSummary(data) {
  delete data.setup_data.password;
  delete data.setup_data.accessToken;
  let out = {};
  if (__ENV.JSON_SUMMARY) {
    out[__ENV.JSON_SUMMARY] = JSON.stringify(data);
  }
  delete data.setup_data.expiry;
  delete data.setup_data.tokenUrl;
  delete data.setup_data.clientId;
  delete data.setup_data.username;
  delete data.setup_data.dataspace;
  delete data.setup_data.transferBaseUrl;
  delete data.setup_data.nsiHostname;
  out[TEST_INPUT] = JSON.stringify(data);
  return out;
}
