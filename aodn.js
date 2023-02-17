// Add on functions to customize the s3 explorer

/**
 *
 */
const getS3BucketByUrl = (url) => {
  const mapping = {
    "data.aodn.org.au": "imos-data",
    "imos-data.prod.aodn.org.au": "imos-data",
    "imos-data.aodn.org.au": "imos-data",
    "data-test.aodn.org.au": "imos-test-data",
    "imos-test-data.prod.aodn.org.au": "imos-test-data",
    "imos-test-data.aodn.org.au": "imos-test-data",
    "binary.aodn.org.au": "imos-binary",
    "binary.prod.aodn.org.au": "imos-binary",
    "content.aodn.org.au": "content.aodn.org.au",
    "localhost": "imos-test-data"
  };

  return mapping[url];
}
/**
 * Get the param in the url
 * @param url
 * @returns {{}}
 */
const getParams = (url) => {

  let queryString = url.substring(url.indexOf('?') + 1);
  let paramsArr = queryString.split('&');
  let params = {};

  for (let i = 0, len = paramsArr.length; i < len; i++) {
    let keyValuePair = paramsArr[i].split('=');
    params[keyValuePair[0]] = keyValuePair[1];
  }

  return params;
}
/**
 * Copy to clipboard using navigator only works if user init https connection.
 * If not then you need to use an obsolete command execCommand('copy')
 * @param txt
 * @returns {Promise<unknown>|Promise<void>}
 */
const copyToClipboard = (url) => {
  // navigator clipboard api needs a secure context (https)
  const c = (txt) => {
    if (navigator.clipboard && window.isSecureContext) {
      // navigator clipboard api method'
      return navigator.clipboard.writeText(txt);
    }
    else {
      // text area method
      const textArea = $("<input/>")
        .attr({type: 'text', id: 'dummy-hidden'})
        .val(txt)
        .appendTo(document.body);

      textArea.focus();
      textArea.select();

      return new Promise((res, rej) => {
        // here the magic happens
        document.execCommand('copy') ? res() : rej();
        textArea.remove();
      });
    }
  };

  const showLinkCopyDialog = (selector) => {
    $(selector).dialog({
      buttons: {
        Ok: function() {
          $(this).dialog("close");
        }
      }
    });
  }

  c(url)
    .then(() => showLinkCopyDialog('#link-copy-success'))
    .catch(()=>  showLinkCopyDialog('#link-copy-fail'));
}

const object2href = (bucket, key) => {
  var enckey = key.split('/').map(function(x) { return encodeURIComponent(x); }).join('/');

  if (isfolder(key)) {
    return document.location.origin + '/index.html?p=' + enckey;
  } else {
    return document.location.origin + '/' + enckey;
  }
}
/**
 * Return an HTML that represent the icons for a particular row.
 * @param data
 * @param type
 * @param full
 * @returns {string}
 */
const displayIcon = (data, type, full) => {
  let url = object2href(s3exp_config.Bucket, data);
  return '<button onclick="copyToClipboard(\'' + url + '\')" class="bi-share-fill"/>';
}
