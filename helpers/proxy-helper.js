'use strict';

exports.init = (apiToken) => {

    const baseOptions = {
        headers: {
            'Authorization': 'Bearer ' + apiToken, // config.API_TOKEN,
            'Content-Type': 'application/json'
        }
    };

    async function handleProxyResponse(url, options){

        const fetchPromise = await fetch(url, options);
        let dataString = await fetchPromise.text();
        let parsedData;
        try {
            if (dataString === '') {
                parsedData = {};
            } else {
                parsedData = JSON.parse(dataString);
            }
        } catch (err) {
            console.log('Got an error when parsing the JSON response from the request to "%s" with GET. The status code was %s and the result was:', url, fetchPromise.status, dataString); // eslint-disable-line
            throw { type: 'fetch-error', permalink: url, status: fetchPromise.status, body: dataString, errorMessage: 'Error parsing json response' };
        }

        if (fetchPromise.ok) {
            return parsedData;
        }

        console.log('Error fetching data from "%s": ', url, fetchPromise.status, parsedData); // eslint-disable-line
        throw { type: 'fetch-error', permalink: url, status: fetchPromise.status, body: dataString, parsedData };
    }

    return {

        get: async function(url, extraHeaders){

            let options = Object.assign({
                method: 'GET'
            }, baseOptions);

            options.headers = Object.assign(options.headers, extraHeaders);

            return handleProxyResponse(url, options);

        },

        post: async function(url, data, extraHeaders){

            if (typeof data !== 'string') { // Convert anything that is not a string into a JSON string
                data = JSON.stringify(data); // eslint-disable-line
            }
            let options = Object.assign({
                method: 'POST',
                body: data
            }, baseOptions);

            options.headers = Object.assign(options.headers, extraHeaders);

            return handleProxyResponse(url, options);
        },

    };

};

