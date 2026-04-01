import http from "k6/http";
import { fail } from "k6";

export function TryToGetNewAccessToken(config) {
  if (!config.tokenUrl || !config.username || !config.password) return;

  if (config.accessToken && config.expiry > new Date().getTime()) return;

  let data = {
    grant_type: "password",
    client_id: config.clientId,
    scope: "openid",
    username: config.username,
    password: config.password,
  };

  //Get new access token
  var params = {
    headers: { Accept: "application/json" },
    responseType: "text",
    tags: { name: "tokenUrl" },
  };
  let res = http.post(config.tokenUrl, data, params);

  if (res.status >= 300) {
    throw `Could not authenticate: ${res.body}`;
  }

  var responseJson = res.json();

  var expiryDate = new Date();
  expiryDate.setSeconds(expiryDate.getSeconds() + responseJson.expires_in);

  config.expiry = expiryDate.getTime();
  config.accessToken = responseJson.access_token;
}

export function initConfig(isNSI) {
  let config = {
    accessToken: "",
    expiry: "",
    tokenUrl: __ENV.KEYCLOAK_AT_URL,
    clientId: __ENV.KEYCLOAK_CLIENT_ID || "app",
    username: __ENV.USERNAME,
    password: __ENV.PASSWORD,
    dataspace: __ENV.TRANSFER_SERVICE_DATASPACE || "stable",
    transferBaseUrl: __ENV.TRANSFER_SERVICE_HOSTNAME || "http://127.0.0.1:93",
    nsiHostname: __ENV.NSIWS_HOSTNAME || "127.0.0.1",
    nsiPort: __ENV.NSIWS_PORT || "81",
    nsiScheme: __ENV.NSIWS_SCHEME || "http",
  };

  let baseUrl = isNSI
    ? config.nsiScheme + "://" + config.nsiHostname + ":" + config.nsiPort
    : config.transferBaseUrl;
  var params = {
    responseType: "text",
    tags: { name: "healthProbe" },
  };

  let healthCheck = http.get(`${baseUrl}/health`, params);

  if (healthCheck.status !== 200) {
    fail(
      `Error: the Service with URL {${healthCheck.request.url} is not responding.`
    );
  }

  console.log(
    `Testing {${baseUrl}} service, version ${
      healthCheck.json().service.details.version
    }`
  );

  return config;
}

// Generate test datasets for data and available constriants calls
export function getAllDataflows(config) {
  TryToGetNewAccessToken(config);
  // Set query parameters
  let params = {
    headers: {
      "Accept-Encoding": "gzip, deflate",
      Authorization: `Bearer ${config.accessToken}`,
      Accept: "application/vnd.sdmx.structure+json; version=1.0; charset=utf-8",
    },
    timeout: "300s",
    responseType: "text",
  };
  // Get all dataflows
  const response = http.get(
    `${config.nsiScheme}://${config.nsiHostname}:${
      config.nsiPort
    }/rest/dataflow/${__ENV.AGENCY_FILTER || "all"}/all/all`,
    params
  );
  // Parse response
  let structures;
  try {
    structures = response.json();
  } catch (error) {
    throw new Error(
      `Cannot parse all dataflow response, got:\n\t${response.body}\n\n${error}`
    );
  }
  const dataflows = structures.data.dataflows;
  const datasets = [];
  // For each dataflow get amount of unfiltered observations and the amount of observations using the default filter
  for (const dataflow of dataflows) {
    TryToGetNewAccessToken(config);
    params.headers.Authorization = `Bearer ${config.accessToken}`;
    // Get available constraint
    const availableConstraintResponse = http.get(
      `${config.nsiScheme}://${config.nsiHostname}:${config.nsiPort}/rest/availableconstraint/${dataflow.agencyID},${dataflow.id},${dataflow.version}`,
      params
    );

    if (availableConstraintResponse.status !== 200) {
      console.warn(
        `No availability contraint for DF ${dataflow.agencyID},${dataflow.id},${dataflow.version}`
      );
      continue;
    }
    // Parse available constriant
    let availableStructures;
    try {
      availableStructures = availableConstraintResponse.json();
    } catch (error) {
      console.warn(
        `Cannot parse availableconstraint response for ${dataflow.agencyID},${dataflow.id},${dataflow.version}, got:\n\t${availableConstraintResponse.body}`
      );
      continue;
    }
    const contentConstraint = availableStructures.data.contentConstraints[0];
    // Get amount of unfiltered observations
    const unfilteredObsCount = Number(
      contentConstraint.annotations.find((a) => a.id === "obs_count")?.title ||
        0
    );
    // Check for a default filter annotation
    const filterAnnotation = dataflow.annotations.find(
      (a) => a.type === "DEFAULT"
    );
    let filterUrl = "";
    // Parse default filter annotation
    if (filterAnnotation) {
      // Split the annotation into it's seperate components
      const defaultFilters = filterAnnotation.title
        .split(",")
        .map((x) => ({ id: x.split("=")[0], value: x.split("=")[1] }));
      // Parse start and end data periods
      const queryParams = [];
      const start = defaultFilters.find((f) => f.id === "TIME_PERIOD_START");
      const end = defaultFilters.find((f) => f.id === "TIME_PERIOD_END");

      if (start) queryParams.push(`startPeriod=${start.value}`);
      if (end) queryParams.push(`endPeriod=${end.value}`);
      // Get the filterable keys
      const keyValues = contentConstraint.cubeRegions[0].keyValues;

      if (!keyValues) {
        console.warn(
          `No keyValues in content constraint ${dataflow.agencyID},${dataflow.id},${dataflow.version}`
        );
        continue;
      }

      let filterUrlBuilder = "";
      // For each key, check if it's present in the default filter, if not add a "."
      for (const keyValue of keyValues) {
        // Time period is already taken care off
        if (keyValue.id === "TIME_PERIOD") continue;
        // Check if the key is in the dafult filter
        const filter = defaultFilters.find((f) => f.id === keyValue.id);
        if (!filter) {
          filterUrlBuilder += ".";
          continue;
        }

        if (!filter.value) {
          filterUrlBuilder += ".";
          continue;
        }
        // Check if each filter value is present in the key
        const valuesMatch = filter.value
          .split("+")
          .every((v) => keyValue.values.includes(v));

        if (valuesMatch) {
          filterUrlBuilder += `.${filter.value}`;
        } else {
          filterUrlBuilder += ".";
        }
      }

      filterUrl = filterUrlBuilder.slice(1);
      // Add the query parameter to the URL
      if (queryParams.length > 0) {
        filterUrl += `?${queryParams.join("&")}`;
      }
    }
    // Get filtered availability constraint
    const filteredConstraintResponse = http.get(
      `${config.nsiScheme}://${config.nsiHostname}:${config.nsiPort}/rest/availableconstraint/${dataflow.agencyID},${dataflow.id},${dataflow.version}/${filterUrl}`,
      params
    );
    // Parse availability constraint
    let filteredStructures;
    try {
      filteredStructures = filteredConstraintResponse.json();
    } catch (error) {
      console.warn(
        `Cannot parse filtered availableconstraint response for ${dataflow.agencyID},${dataflow.id},${dataflow.version}, got:\n\t${filteredConstraintResponse.body}`
      );
      continue;
    }
    const filteredContentConstraint =
      filteredStructures.data.contentConstraints[0];
    // Get number of observations
    const filteredObsCount = Number(
      filteredContentConstraint.annotations.find((a) => a.id === "obs_count")
        ?.title || 0
    );
    // Add dataset to the list
    datasets.push({
      dataflow: `${dataflow.agencyID},${dataflow.id},${dataflow.version}`,
      defaultFilter: filterUrl,
      unfilteredObsCount,
      filteredObsCount,
    });
  }

  config.datasets = datasets;
}

// Generate test structure sets for structure calls
export function getAllStructures(config, weights) {
  TryToGetNewAccessToken(config);
  // Set query parameters
  const params = {
    headers: {
      "Accept-Encoding": "gzip, deflate",
      Authorization: `Bearer ${config.accessToken}`,
      Accept: "application/vnd.sdmx.structure+json; version=1.0; charset=utf-8",
    },
    timeout: "300s",
    responseType: "text",
  };
  // For each structure type included in the weights file, get all strucutres
  for (const type of Object.keys(weights.structure.type)) {
    config[type] = [];
    // Get all the structures
    const response = http.get(
      `${config.nsiScheme}://${config.nsiHostname}:${
        config.nsiPort
      }/rest/${type}/${__ENV.AGENCY_FILTER || "all"}/all/all?detail=allstubs`,
      params
    );
    // Parse the structures
    let structures;
    try {
      structures = response.json();
    } catch (error) {
      console.warn(
        `Cannot parse all ${type} response, got:\n\t${response.body}`
      );
      continue;
    }

    const dataKey = Object.keys(structures.data)[0];
    const data = structures.data[dataKey];
    // Add structures to the list
    config[type] = data.map((item) => ({
      agencyID: item.agencyID,
      id: item.id,
      version: item.version,
    }));
  }
}

export function getSizeTag(obsCount) {
  const sizeTags = [
    { threshold: 1, tag: "empty" },
    { threshold: 10000, tag: "xSmall" }, //10.000
    { threshold: 100000, tag: "small" }, //100.000
    { threshold: 1000000, tag: "medium" }, //1.000.000
    { threshold: 10000000, tag: "large" }, //10.000.000
    { threshold: 100000000, tag: "xLarge" }, //100.000.000
  ];
  return (
    sizeTags.find(({ threshold, tag }) => obsCount < threshold)?.tag ||
    "xxLarge"
  );
}

export function calculateCDF(weights) {
  const keys = Object.keys(weights);
  const total = keys.reduce((sum, k) => sum + (weights[k].weight || 0), 0);
  let cumulative = 0;
  return keys.map((k) => {
    cumulative += (weights[k].weight || 0) / total;
    return { key: k, cumulative };
  });
}

export function getWeightedKey(cdf) {
  const r = Math.random();
  for (let cumulative of cdf) {
    if (r < cumulative.cumulative) {
      return cumulative.key;
    }
  }
  return cdf[cdf.length - 1].key;
}

// Fisher–Yates shuffle
export function shuffle(array) {
  let currentIndex = array.length;

  // While there remain elements to shuffle...
  while (currentIndex != 0) {
    // Pick a remaining element...
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
}

export function cartesianProduct(arrays) {
  return arrays.reduce(
    (acc, curr) => acc.flatMap((a) => curr.map((c) => [...a, c])),
    [[]]
  );
}
