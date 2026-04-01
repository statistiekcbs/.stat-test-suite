# .Stat test suite

The .Stat test suite is an extension of the OECD test suite.

Running on k6, it provides a way to fire random requests at an SDMX endpoint based on the contents of that endpoint.
The characteristics of each requests are determined based on weights for each characteristic given in a `weights.json` file.
Thresholds for the test can be set based on those characteristics, or combinations thereoff, in a `thresholds.json` file.

There are 2 test scripts with which any test scenario kan be created and there is one init script that can be run once to prevent subsequent tests from gathering the same testdata over and over again.

## Smoke tests

Somke tests can be executed with the `smoke-test.js` script.
This script will fire each combination of characteristics given in the `weights.json` file once.

## Load tests

Load tests can be executed with the `load-test.js` script.
This script, like the OECD scripts, will generate a randomly weighted set of characteristics based on the weights in `weights.json` file.
These characteristics are combined into a API query.
If a data query is selected, the dataflow to query is randomly selected from the ones available at the endpoint.
If a structure query is secleted with the characteristic to load a single structure, that structure is randomly chosen from all the ones available of the given type.

## Initialization

These scripts all start by querying the API enpoint for all it's dataflows, then each dataflow individualy to get it's amount of data points.
It then queries for all objects of every structure type.
All these entries are then used in the test scripts.

For large dataspaces, this proces can take up a lot of time, especially since it is executed before each run.
In order to avoid this, the `init.js` script can be run once to generate the test data.
The test scripts can then be given a path to the JSON test data to use that instead of generating the test data again.

**Note:** you might need to increase the value for `K6_SETUP_TIMEOUT` to be able to scrape the whole endpoint.

## Usage

[k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) must be installed or run the code in a [k6 container](https://hub.docker.com/r/grafana/k6).

Edit the `weights.json` and `thresholds.json` to match your use-case.

The `weight` van be adjusted according to needs. Every `header` value can also be edited if needed as it will be used literally, this might be especially useful for the range header for data queries. Every key under `dimensionAtObservation`, `type`, `references` and `detail` can also be modified, removed or added as they will also be taken literally.
It is also possible to use the `weight_oecd.json` (after renaming it to `weights.json`) for a selection of weights matching [this real, public facing, traffic recording](https://gitlab.com/sis-cc/.stat-suite/dotstatsuite-quality-assurance/-/blob/master/PerformanceTests/oecd/public-2025-01-14-14h.json).

`thresholds.json` follows the k6 thresholds notation converted to JSON. Refer the [k6 docs on thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/) to fill to make your own.

Set the environment vars listed in [Parameters](#parameters) as needed. Especially `NSIWS_SCHEME`, `NSIWS_HOSTNAME` and `NSIWS_PORT` might need setting. You can also set any other k6 specific env var at this point.

If the data available at the endpoint is large, we advise running `init.js` first as mentioned in [Initialization](#initialization).
You can do so as follows:

```shell
NSIWS_SCHEME=https NSIWS_HOSTNAME=my.nsiws.host NSIWS_PORT=443 TEST_INPUT=test_input.json K6_SETUP_TIMEOUT=1h k6 run init.js
```

You can then run the load or smoke test as follows:

```shell
NSIWS_SCHEME=https NSIWS_HOSTNAME=my.nsiws.host NSIWS_PORT=443 TESTSET_FILE=test_input.json k6 run load-test.js
```

## Parameters

### Common

| Env var | Description | Default value |
| ------- | ----------- | ------------- |
| `KEYCLOAK_AT_URL` | Keycloak token URL | |
| `KEYCLOAK_CLIENT_ID` | Keycloak client ID | "app" |
| `USERNAME` | Username to exectute the queries with | |
| `PASSWORD` | Password for the username to authenticate with | |
| `TRANSFER_SERVICE_DATASPACE` | Name of the dataspace to use for uploads (not implemented yet) | "stable" |
| `TRANSFER_SERVICE_HOSTNAME` | Base URL of the transfer service | "http://127.0.0.1:93" |
| `NSIWS_SCHEME` | Scheme of the SDMX endpoint to test against | "http" |
| `NSIWS_HOSTNAME` | Hostname of the SDMX endpoint to test against | "127.0.0.1" |
| `NSIWS_PORT` | Port of the SDMX endpoint to test against | "81" |
| `JSON_SUMMARY` | File to write the test summary in JSON format too | |

### Initialization

| Env var | Description | Default value |
| ------- | ----------- | ------------- |
| `TEST_INPUT`| JSON file to write the generated test input to  | "test_input.json" |
| `AGENCY_FILTER` | Filter the input data with this agency ID | |

### Smoke

| Env var | Description | Default value |
| ------- | ----------- | ------------- |
| `SAMPLE_RATE` | Controls how much dataflow are queried, 100 is all dataflows, 0 is a single one | "100" |
| `QUERY_TIMEOUT` | Sets the timeout for the individual queries | "60s" |
| `TESTSET_FILE` | Path to a pre generated test dataset, generated using the init script. When set, the test script will not regenerate the test data | |

### Load

| Env var | Description | Default value |
| ------- | ----------- | ------------- |
| `QUERY_TIMEOUT` | Sets the timeout for the individual queries | "60s" |
| `GRACEFUL_STOP` | Sets the time to wait at the end of the test for the open calls to finish | Value of `QUERY_TIMEOUT` |
| `TESTSET_FILE` | Path to a pre generated test dataset, generated using the init script. When set, the test script will not regenerate the test data | |
| `LOAD_RATE` | Rate, in requests per second, at which to fire off a request to the endpoint| "50" |
| `LOAD_DURATION` | Duration during which the `LOAD_RATE` is applied to the endpoint | "15m" |
| `LOAD_RAMPUP` | Time it takes to get from 0 to `LOAD_RATE` requests per second at the start of the test | "60s" |
| `LOAD_RAMPDOWN` | Time it takes to get from `LOAD_RATE` to 0 requests per second at the end of the test | "60s" |
| `PREALLOCATED_VUS` | Number of total virtual users to run each test with. The script balances the amount of VUs per query type | "150" |
| `EMPTY_STATUS_CODE` | The HTTP status code returned by the API when a data query returns no results | "404" |
| `AGENCY_FILTER` | Filter the input data with this agency ID | |
