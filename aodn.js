// Add on functions to customize the s3 explorer

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
/**
 * Return an HTML that represent the icons for a particular row.
 * @param data
 * @param type
 * @param full
 * @returns {string}
 */
const displayIcon = (data, type, full) => {
  let url = object2hrefvirt(s3exp_config.Bucket, data);
  return '<button onclick="copyToClipboard(\'' + url + '\')" class="bi-share-fill"/>';
}
