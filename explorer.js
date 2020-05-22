// Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License").
//
// You may not use this file except in compliance with the License. A copy
// of the License is located at
//
// http://aws.amazon.com/apache2.0/
//
// or in the "license" file accompanying this file. This file is distributed
// on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific language governing
// permissions and limitations under the License.

/* ESLint file-level overrides */
/* global AWS bootbox document moment window $ angular:true */
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
/* eslint-disable no-console */
/* eslint no-plusplus: "off" */
/* eslint-env es6 */

const s3ExplorerColumns = {
    check: 0, object: 1, folder: 2, date: 3, timestamp: 4, storageclass: 5, size: 6,
};

// Cache frequently-used selectors and data table
const $tb = $('#s3objects-table');
const $bc = $('#breadcrumb');
const $bl = $('#bucket-loader');

// Map S3 storage types to text
const mapStorage = {
    STANDARD: 'Standard',
    STANDARD_IA: 'Standard IA',
    ONEZONE_IA: 'One Zone-IA',
    REDUCED_REDUNDANCY: 'Reduced Redundancy',
    GLACIER: 'Glacier',
    INTELLIGENT_TIERING: 'Intelligent Tiering',
    DEEP_ARCHIVE: 'Deep Archive',
};

// Debug utility to complement console.log
const DEBUG = (() => {
    const timestamp = () => {};
    timestamp.toString = () => `[DEBUG ${moment().format()}]`;

    return {
        log: console.log.bind(console, '%s', timestamp),
    };
})();

// Utility to convert bytes to readable text e.g. "2 KB" or "5 MB"
function bytesToSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const ii = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
    return `${Math.round(bytes / (1024 ** ii), 2)} ${sizes[ii]}`;
}

// Escape strings of HTML
function htmlEscape(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\//g, '&#x2F;')
        .replace(/`/g, '&#x60;')
        .replace(/=/g, '&#x3D;');
}

// Convert cars/vw/golf.png to golf.png
function fullpath2filename(path, escape = false) {
    const rc = path.replace(/^.*[\\/]/, '');
    return escape ? htmlEscape(rc) : rc;
}

// Convert cars/vw/golf.png to cars/vw/
function fullpath2pathname(path, escape = false) {
    const index = path.lastIndexOf('/');
    const rc = (index === -1) ? '/' : path.substring(0, index + 1);
    return escape ? htmlEscape(rc) : rc;
}

// Convert cars/vw/ to vw/
function prefix2folder(prefix, escape = false) {
    const parts = prefix.split('/');
    const rc = `${parts[parts.length - 2]}/`;
    return escape ? htmlEscape(rc) : rc;
}

// Convert cars/vw/sedans/ to cars/vw/
function prefix2parentfolder(prefix, escape = false) {
    const parts = prefix.split('/');
    parts.splice(parts.length - 2, 1);
    const rc = parts.join('/');
    return escape ? htmlEscape(rc) : rc;
}

// Convert cars/vw/golf.png to  cars/.../golf.png
const pathLimit = 80; // Max allowed path length
const pathHellip = String.fromCharCode(8230); // '&hellip;' char
function path2short(path, escape = false) {
    if (path.length < pathLimit) return escape ? htmlEscape(path) : path;

    const soft = `${prefix2parentfolder(fullpath2pathname(path)) + pathHellip}/${fullpath2filename(path)}`;
    if (soft.length < pathLimit && soft.length > 2) return escape ? htmlEscape(soft) : soft;

    const hard = `${path.substring(0, path.indexOf('/') + 1) + pathHellip}/${fullpath2filename(path)}`;
    const rc = hard.length < pathLimit ? hard : path.substring(0, pathLimit) + pathHellip;
    return escape ? htmlEscape(rc) : rc;
}

// Virtual-hosted-style URL, ex: https://mybucket1.s3.amazonaws.com/index.html
function object2hrefvirt(bucket, key, escape = false) {
    const enckey = key.split('/').map(x => encodeURIComponent(x)).join('/');
    const rc = `${document.location.protocol}//${bucket}.s3.amazonaws.com/${enckey}`;
    return escape ? htmlEscape(rc) : rc;
}

// Path-style URLs, ex: https://s3.amazonaws.com/mybucket1/index.html
// eslint-disable-next-line no-unused-vars
function object2hrefpath(bucket, key, escape = false) {
    const enckey = key.split('/').map(x => encodeURIComponent(x)).join('/');
    const rc = `${document.location.protocol}//s3.amazonaws.com/${bucket}/${enckey}`;
    return escape ? htmlEscape(rc) : rc;
}

function isfolder(path) {
    return path.endsWith('/');
}

function stripLeadTrailSlash(s) {
    return s.replace(/^\/+/g, '').replace(/\/+$/g, '');
}

//
// Shared service that all controllers can use
//
function SharedService($rootScope) {
    DEBUG.log('SharedService init');

    const shared = {
        settings: null, viewprefix: null, skew: true,
    };

    shared.getSettings = () => this.settings;

    shared.addFiles = (files) => { this.added_files = files; };

    shared.getAddedFiles = () => this.added_files;

    shared.hasAddedFiles = () => Object.prototype.hasOwnProperty.call(this, 'added_files');

    shared.resetAddedFiles = () => { delete this.added_files; };

    shared.changeSettings = (settings) => {
        DEBUG.log('SharedService::changeSettings');
        DEBUG.log('SharedService::changeSettings settings', settings);

        this.settings = settings;
        this.viewprefix = null;
        $.fn.dataTableExt.afnFiltering.length = 0;

        // AWS.config.update(settings.cred);
        // AWS.config.update({ region: settings.region });
        AWS.config.update(Object.assign(settings.cred, { region: settings.region }));

        if (this.skew) {
            this.correctClockSkew(settings.bucket);
            this.skew = false;
        }

        if (settings.mfa.use === 'yes') {
            const iam = new AWS.IAM();
            DEBUG.log('listMFADevices');

            iam.listMFADevices({}, (err1, data1) => {
                if (err1) {
                    DEBUG.log('listMFADevices error:', err1);
                } else {
                    const sts = new AWS.STS();
                    DEBUG.log('listMFADevices data:', data1);

                    const params = {
                        DurationSeconds: 3600,
                        SerialNumber: data1.MFADevices[0].SerialNumber,
                        TokenCode: settings.mfa.code,
                    };

                    DEBUG.log('getSessionToken params:', params);
                    sts.getSessionToken(params, (err2, data2) => {
                        if (err2) {
                            DEBUG.log('getSessionToken error:', err2);
                        } else {
                            DEBUG.log('getSessionToken data:', data2);
                            this.settings.stscred = {
                                accessKeyId: data2.Credentials.AccessKeyId,
                                secretAccessKey: data2.Credentials.SecretAccessKey,
                                sessionToken: data2.Credentials.SessionToken,
                            };
                            AWS.config.update(this.settings.stscred);
                            $rootScope.$broadcast('broadcastChangeSettings', { settings: this.settings });
                        }
                    });
                }
            });
        } else {
            $rootScope.$broadcast('broadcastChangeSettings', { settings });
        }
    };

    shared.changeViewPrefix = (prefix) => {
        DEBUG.log('SharedService::changeViewPrefix');

        if (this.settings.delimiter) {
            // Folder-level view
            this.settings.prefix = prefix;
            this.viewprefix = null;
            $.fn.dataTableExt.afnFiltering.length = 0;
            $rootScope.$broadcast('broadcastChangePrefix', { prefix });
        } else {
            // Bucket-level view
            this.viewprefix = prefix;
            $rootScope.$broadcast('broadcastChangePrefix', { viewprefix: prefix });
        }
    };

    shared.getViewPrefix = () => this.viewprefix || this.settings.prefix;

    shared.viewRefresh = () => $rootScope.$broadcast('broadcastViewRefresh');

    shared.trashObjects = (bucket, keys) => $rootScope.$broadcast('broadcastTrashObjects', { bucket, keys });

    shared.addFolder = (_bucket, _folder) => $rootScope.$broadcast('broadcastViewRefresh');

    // We use pre-signed URLs so that the user can securely download
    // objects. For security reasons, we make these URLs time-limited and in
    // order to do that we need the client's clock to be in sync with the AWS
    // S3 endpoint otherwise we might create URLs that are immediately invalid,
    // for example if the client's browser time is 55 minutes behind S3's time.
    shared.correctClockSkew = (Bucket) => {
        const s3 = new AWS.S3();
        DEBUG.log('Invoke headBucket:', Bucket);

        // Head the bucket to get a Date response. The 'date' header will need
        // to be exposed in S3 CORS configuration.
        s3.headBucket({ Bucket }, (err, data) => {
            if (err) {
                DEBUG.log('headBucket error:', err);
            } else {
                DEBUG.log('headBucket data:', JSON.stringify(data));
                DEBUG.log('headBucket headers:', JSON.stringify(this.httpResponse.headers));

                if (this.httpResponse.headers.date) {
                    const date = Date.parse(this.httpResponse.headers.date);
                    DEBUG.log('headers date:', date);
                    AWS.config.systemClockOffset = new Date() - date;
                    DEBUG.log('clock offset:', AWS.config.systemClockOffset);
                    // Can now safely generate presigned urls
                }
            }
        });
    };

    // Common error handling is done here in the shared service.
    shared.showError = (params, err) => {
        DEBUG.log(err);
        const { message, code } = err;
        const errors = Object.entries(err).map(([key, value]) => ({ key, value }));
        const args = {
            params, message, code, errors,
        };
        $rootScope.$broadcast('broadcastError', args);
    };

    return shared;
}

//
// ViewController: code associated with the main S3 Explorer table that shows
// the contents of the current bucket/folder and allows the user to downloads
// files, delete files, and do various other S3 functions.
//
// eslint-disable-next-line no-shadow
function ViewController($scope, SharedService) {
    DEBUG.log('ViewController init');
    window.viewScope = $scope; // for debugging
    $scope.view = {
        bucket: null, prefix: null, settings: null, objectCount: 0, keys_selected: [],
    };
    $scope.stop = false;

    // Delegated event handler for S3 object/folder clicks. This is delegated
    // because the object/folder rows are added dynamically and we do not want
    // to have to assign click handlers to each and every row.
    $tb.on('click', 'a', (e) => {
        const { currentTarget: target } = e;
        e.preventDefault();
        DEBUG.log('target href:', target.href);
        DEBUG.log('target dataset:', JSON.stringify(target.dataset));

        if (target.dataset.s3 === 'folder') {
            // User has clicked on a folder so navigate into that folder
            SharedService.changeViewPrefix(target.dataset.s3key);
        } else if ($scope.view.settings.auth === 'anon') {
            // Unauthenticated user has clicked on an object so download it
            // in new window/tab
            window.open(target.href, '_blank');
        } else {
            // Authenticated user has clicked on an object so create pre-signed
            // URL and download it in new window/tab
            const s3 = new AWS.S3();
            const params = {
                Bucket: $scope.view.settings.bucket, Key: target.dataset.s3key, Expires: 15,
            };
            DEBUG.log('params:', params);
            s3.getSignedUrl('getObject', params, (err, url) => {
                if (err) {
                    DEBUG.log('err:', err);
                    SharedService.showError(params, err);
                } else {
                    DEBUG.log('url:', url);
                    window.open(url, '_blank');
                }
            });
        }
        return false;
    });

    // Delegated event handler for breadcrumb clicks.
    $bc.on('click', 'a', (e) => {
        DEBUG.log('breadcrumb li click');
        e.preventDefault();
        const { currentTarget: target } = e;
        DEBUG.log('target dataset:', JSON.stringify(target.dataset));
        SharedService.changeViewPrefix(target.dataset.prefix);
        return false;
    });

    $scope.$on('broadcastChangeSettings', (e, args) => {
        DEBUG.log('ViewController', 'broadcast change settings:', args.settings);
        $scope.view.objectCount = 0;
        $scope.view.settings = args.settings;
        $scope.refresh();
    });

    $scope.$on('broadcastChangePrefix', (e, args) => {
        DEBUG.log('ViewController', 'broadcast change prefix args:', args);
        $scope.$apply(() => {
            // Create breadcrumbs from current path (S3 bucket plus folder hierarchy)
            $scope.folder2breadcrumbs($scope.view.settings.bucket, args.viewprefix || args.prefix);

            if (args.viewprefix !== undefined && args.viewprefix !== null) {
                // In bucket-level view we already have the data so we just need to
                // filter it on prefix.
                $.fn.dataTableExt.afnFiltering.length = 0;

                $.fn.dataTableExt.afnFiltering.push(
                    // Filter function returns true to include item in view
                    (_o, d, _i) => d[1] !== args.viewprefix && d[1].startsWith(args.viewprefix),
                );

                // Re-draw the table
                $tb.DataTable().draw();
            } else {
                // In folder-level view, we actually need to query the data for the
                // the newly-selected folder.
                $.fn.dataTableExt.afnFiltering.length = 0;
                $scope.view.settings.prefix = args.prefix;
                $scope.refresh();
            }
        });
    });

    $scope.$on('broadcastViewRefresh', () => {
        DEBUG.log('ViewController', 'broadcast view refresh');
        $scope.$apply(() => {
            $scope.refresh();
        });
    });

    $scope.renderObject = (data, _type, full) => {
        // DEBUG.log('renderObject:', JSON.stringify(full));
        const hrefv = object2hrefvirt($scope.view.settings.bucket, data);

        function buildAnchor(s3key, href, text, download) {
            const a = $('<a>');
            a.attr({ 'data-s3key': s3key });
            a.attr({ href });
            if (download) {
                a.attr({ 'data-s3': 'object' });
                a.attr({ download });
            } else {
                a.attr({ 'data-s3': 'folder' });
            }
            a.text(text);
            return a.prop('outerHTML');
        }

        function render(d, href, text, download) {
            if (download) {
                return buildAnchor(d, href, text, download);
            }

            return buildAnchor(d, href, text);
        }

        if (full.CommonPrefix) {
            if ($scope.view.settings.prefix) {
                return render(data, hrefv, prefix2folder(data));
            }

            return render(data, hrefv, data);
        }

        return render(data, hrefv, fullpath2filename(data), fullpath2filename(data));
    };

    $scope.renderFolder = (data, _type, full) => (full.CommonPrefix ? '' : fullpath2pathname(data, true));

    $scope.progresscb = (objects, folders) => {
        DEBUG.log('ViewController', 'Progress cb objects:', objects);
        DEBUG.log('ViewController', 'Progress cb folders:', folders);
        $scope.$apply(() => {
            $scope.view.objectCount += objects + folders;
        });
    };

    $scope.refresh = () => {
        DEBUG.log('refresh');
        if ($scope.running()) {
            DEBUG.log('running, stop');
            $scope.listobjectsstop();
        } else {
            DEBUG.log('refresh', $scope.view.settings);
            $scope.view.objectCount = 0;
            $scope.folder2breadcrumbs(
                $scope.view.settings.bucket,
                SharedService.getViewPrefix(),
            );
            $scope.listobjects(
                $scope.view.settings.bucket,
                $scope.view.settings.prefix,
                $scope.view.settings.delimiter,
            );
        }
    };

    $scope.upload = () => {
        DEBUG.log('Add files');
        $('#addedFiles').trigger('click');
    };

    $scope.trash = () => {
        DEBUG.log('Trash:', $scope.view.keys_selected);
        if ($scope.view.keys_selected.length > 0) {
            SharedService.trashObjects($scope.view.settings.bucket, $scope.view.keys_selected);
        }
    };

    $scope.running = () => $bl.hasClass('fa-spin');

    $scope.folder2breadcrumbs = (bucket, prefix) => {
        DEBUG.log('Breadcrumbs bucket:', bucket);
        DEBUG.log('Breadcrumbs prefix:', prefix);

        // Empty the current breadcrumb list
        $('#breadcrumb li').remove();

        // This array will contain the needed prefixes for each folder level.
        const prefixes = [''];
        let buildprefix = '';

        if (prefix) {
            prefixes.push(...prefix.replace(/\/$/g, '').split('/'));
        }

        // Add bucket followed by prefix segments to make breadcrumbs
        for (let ii = 0; ii < prefixes.length; ii++) {
            let li;

            // Bucket
            if (ii === 0) {
                const a1 = $('<a>').attr('href', '#').text(bucket);
                li = $('<li>').append(a1);
            // Followed by n - 1 intermediate folders
            } else if (ii < prefixes.length - 1) {
                const a2 = $('<a>').attr('href', '#').text(prefixes[ii]);
                li = $('<li>').append(a2);
            // Followed by current folder
            } else {
                li = $('<li>').text(prefixes[ii]);
            }

            // Accumulate prefix
            if (ii) {
                buildprefix = `${buildprefix}${prefixes[ii]}/`;
            }

            // Save prefix & bucket data for later click handler
            li.children('a').attr('data-prefix', buildprefix).attr('data-bucket', bucket);

            // Add to breadcrumbs
            $bc.append(li);
        }

        // Make last breadcrumb active
        $('#breadcrumb li:last').addClass('active');
    };

    $scope.listobjectsstop = (stop) => {
        DEBUG.log('ViewController', 'listobjectsstop:', stop || true);
        $scope.stop = stop || true;
    };

    // This is the listObjects callback
    $scope.listobjectscb = (err, data) => {
        DEBUG.log('Enter listobjectscb');
        if (err) {
            DEBUG.log('Error:', JSON.stringify(err));
            DEBUG.log('Error:', err.stack);
            $bl.removeClass('fa-spin');
            const params = { bucket: $scope.view.bucket, prefix: $scope.view.prefix };
            SharedService.showError(params, err);
        } else {
            let marker;

            // Store marker before filtering data. Note that Marker is the
            // previous request marker, not the marker to use on the next call
            // to listObject. For the one to use on the next invocation you
            // need to use NextMarker or retrieve the key of the last item.
            if (data.IsTruncated) {
                if (data.NextMarker) {
                    marker = data.NextMarker;
                } else if (data.Contents.length > 0) {
                    marker = data.Contents[data.Contents.length - 1].Key;
                }
            }

            const count = { objects: 0, folders: 0 };

            // NOTE: folders are returned in CommonPrefixes if delimiter is
            // supplied on the listObjects call and in Contents if delimiter
            // is not supplied on the listObjects call, so we may need to
            // source our DataTable folders from Contents or CommonPrefixes.
            // DEBUG.log("Contents", data.Contents);
            $.each(data.Contents, (index, value) => {
                if (value.Key === data.Prefix) {
                    // ignore this folder
                } else if (isfolder(value.Key)) {
                    $tb.DataTable().row.add({
                        CommonPrefix: true, Key: value.Key, StorageClass: null,
                    });
                    count.folders++;
                } else {
                    $tb.DataTable().row.add(value);
                    count.objects++;
                }
            });

            // Add folders to the datatable. Note that folder entries in the
            // DataTable will have different content to object entries and the
            // folders can be identified by CommonPrefix=true.
            // DEBUG.log("CommonPrefixes:", data.CommonPrefixes);
            $.each(data.CommonPrefixes, (index, value) => {
                $tb.DataTable().rows.add([
                    { CommonPrefix: true, Key: value.Prefix, StorageClass: null },
                ]);
                count.objects++;
            });

            // Re-draw the table
            $tb.DataTable().draw();

            // Make progress callback to report objects read so far
            $scope.progresscb(count.objects, count.folders);

            const params = {
                Bucket: data.Name, Prefix: data.Prefix, Delimiter: data.Delimiter, Marker: marker,
            };

            // DEBUG.log("AWS.config:", JSON.stringify(AWS.config));

            if ($scope.stop) {
                DEBUG.log('Bucket', data.Name, 'stopped');
                $bl.removeClass('fa-spin');
            } else if (data.IsTruncated) {
                DEBUG.log('Bucket', data.Name, 'truncated');
                const s3 = new AWS.S3(AWS.config);
                if (AWS.config.credentials && AWS.config.credentials.accessKeyId) {
                    DEBUG.log('Make S3 authenticated call to listObjects');
                    s3.listObjects(params, $scope.listobjectscb);
                } else {
                    DEBUG.log('Make S3 unauthenticated call to listObjects');
                    s3.makeUnauthenticatedRequest('listObjects', params, $scope.listobjectscb);
                }
            } else {
                DEBUG.log('Bucket', data.Name, 'listing complete');
                $bl.removeClass('fa-spin');
            }
        }
    };

    // Start the spinner, clear the table, make an S3 listObjects request
    $scope.listobjects = (Bucket, Prefix, Delimiter, Marker) => {
        DEBUG.log('Enter listobjects');

        // If this is the initial listObjects
        if (!Marker) {
            // Checked on each event cycle to stop list prematurely
            $scope.stop = false;

            // Start spinner and clear table
            $scope.view.keys_selected = [];
            $bl.addClass('fa-spin');
            $tb.DataTable().clear();
            $tb.DataTable().column(s3ExplorerColumns.folder).visible(!Delimiter);
        }

        const s3 = new AWS.S3(AWS.config);
        const params = {
            Bucket, Prefix, Delimiter, Marker,
        };

        // DEBUG.log("AWS.config:", JSON.stringify(AWS.config));

        // Now make S3 listObjects call(s)
        if (AWS.config.credentials && AWS.config.credentials.accessKeyId) {
            DEBUG.log('Make S3 authenticated call to listObjects, params:', params);
            s3.listObjects(params, $scope.listobjectscb);
        } else {
            DEBUG.log('Make S3 unauthenticated call to listObjects, params:', params);
            s3.makeUnauthenticatedRequest('listObjects', params, $scope.listobjectscb);
        }
    };

    this.isfolder = path => path.endsWith('/');

    // Individual render functions so that we can control how column data appears
    this.renderSelect = (data, type, _full) => {
        if (type === 'display') {
            return '<span class="text-center"><input type="checkbox"></span>';
        }

        return '';
    };

    this.renderObject = (data, type, full) => {
        if (type === 'display') {
            return $scope.renderObject(data, type, full);
        }

        return data;
    };

    this.renderFolder = (data, type, full) => $scope.renderFolder(data, type, full);

    this.renderLastModified = (data, _type, _full) => {
        if (data) {
            return moment(data).fromNow();
        }

        return '';
    };

    this.renderTimestamp = (data, _type, _full) => {
        if (data) {
            return moment(data).local().format('YYYY-MM-DD HH:mm:ss');
        }

        return '';
    };

    this.renderStorageClass = (data, _type, _full) => {
        if (data) {
            return mapStorage[data];
        }

        return '';
    };

    // Object sizes are displayed in nicer format e.g. 1.2 MB but are otherwise
    // handled as simple number of bytes e.g. for sorting purposes
    this.dataSize = (source, type, _val) => {
        if (source.Size) {
            return (type === 'display') ? bytesToSize(source.Size) : source.Size;
        }

        return '';
    };

    // Initial DataTable settings (must only do this one time)
    $tb.DataTable({
        iDisplayLength: 25,
        order: [[2, 'asc'], [1, 'asc']],
        aoColumnDefs: [
            {
                aTargets: [0], mData: null, mRender: this.renderSelect, sClass: 'text-center', sWidth: '20px', bSortable: false,
            },
            {
                aTargets: [1], mData: 'Key', mRender: this.renderObject, sType: 'key',
            },
            {
                aTargets: [2], mData: 'Key', mRender: this.renderFolder,
            },
            {
                aTargets: [3], mData: 'LastModified', mRender: this.renderLastModified,
            },
            {
                aTargets: [4], mData: 'LastModified', mRender: this.renderTimestamp,
            },
            {
                aTargets: [5], mData: 'StorageClass', mRender: this.renderStorageClass,
            },
            {
                aTargets: [6], mData: this.dataSize,
            },
        ],
    });

    // Custom ascending sort for Key column so folders appear before objects
    $.fn.dataTableExt.oSort['key-asc'] = (a, b) => {
        const x = (isfolder(a) ? `0-${a}` : `1-${a}`).toLowerCase();
        const y = (isfolder(b) ? `0-${b}` : `1-${b}`).toLowerCase();
        if (x < y) return -1;
        if (x > y) return 1;
        return 0;
    };

    // Custom descending sort for Key column so folders appear before objects
    $.fn.dataTableExt.oSort['key-desc'] = (a, b) => {
        const x = (isfolder(a) ? `1-${a}` : `0-${a}`).toLowerCase();
        const y = (isfolder(b) ? `1-${b}` : `0-${b}`).toLowerCase();
        if (x < y) return 1;
        if (x > y) return -1;
        return 0;
    };

    // Handle click on selection checkbox
    $('#s3objects-table tbody').on('click', 'input[type="checkbox"]', (e1) => {
        const checkbox = e1.currentTarget;
        const $row = $(checkbox).closest('tr');
        const data = $tb.DataTable().row($row).data();
        let index = -1;

        // Prevent click event from propagating to parent
        e1.stopPropagation();

        // Find matching key in currently checked rows
        index = $scope.view.keys_selected.findIndex(e2 => e2.Key === data.Key);

        // Remove or add checked row as appropriate
        if (checkbox.checked && index === -1) {
            $scope.view.keys_selected.push(data);
        } else if (!checkbox.checked && index !== -1) {
            $scope.view.keys_selected.splice(index, 1);
        }

        $scope.$apply(() => {
            // Doing this to force Angular to update models
            DEBUG.log('Selected rows:', $scope.view.keys_selected);
        });

        if (checkbox.checked) {
            $row.addClass('selected');
        } else {
            $row.removeClass('selected');
        }
    });

    // Handle click on table cells
    $('#s3objects-table tbody').on('click', 'td', (e) => {
        $(e.currentTarget).parent().find('input[type="checkbox"]').trigger('click');
    });
}

//
// AddFolderController: code associated with the add folder function.
//
// eslint-disable-next-line no-shadow
function AddFolderController($scope, SharedService) {
    DEBUG.log('AddFolderController init');
    $scope.add_folder = {
        settings: null, bucket: null, entered_folder: '', view_prefix: '/',
    };
    window.addFolderScope = $scope; // for debugging
    DEBUG.log('AddFolderController add_folder init', $scope.add_folder);

    $scope.$on('broadcastChangeSettings', (e, args) => {
        DEBUG.log('AddFolderController', 'broadcast change settings bucket:', args.settings.bucket);
        $scope.add_folder.settings = args.settings;
        $scope.add_folder.bucket = args.settings.bucket;
        $scope.add_folder.view_prefix = args.settings.prefix || '/';
        DEBUG.log('AddFolderController add_folder bcs', $scope.add_folder);
    });

    $scope.$on('broadcastChangePrefix', (e, args) => {
        DEBUG.log('AddFolderController', 'broadcast change prefix args:', args);
        $scope.add_folder.view_prefix = args.prefix || args.viewprefix || '/';
        DEBUG.log('AddFolderController add_folder bcp', $scope.add_folder);
    });

    $scope.addFolder = () => {
        DEBUG.log('Add folder');
        DEBUG.log('Current prefix:', $scope.add_folder.view_prefix);

        const ef = stripLeadTrailSlash($scope.add_folder.entered_folder);
        const vpef = $scope.add_folder.view_prefix + ef;
        const folder = `${stripLeadTrailSlash(vpef)}/`;
        DEBUG.log('Calculated folder:', folder);

        const s3 = new AWS.S3(AWS.config);
        const params = { Bucket: $scope.add_folder.bucket, Key: folder };

        DEBUG.log('Invoke headObject:', params);

        // Test if an object with this key already exists
        s3.headObject(params, (err1, _data1) => {
            if (err1 && err1.code === 'NotFound') {
                DEBUG.log('Invoke putObject:', params);

                // Create a zero-sized object to simulate a folder
                s3.putObject(params, (err2, _data2) => {
                    if (err2) {
                        DEBUG.log('putObject error:', err2);
                        bootbox.alert('Error creating folder:', err2);
                    } else {
                        SharedService.addFolder(params.Bucket, params.Key);
                        $('#AddFolderModal').modal('hide');
                        $scope.add_folder.entered_folder = '';
                    }
                });
            } else if (err1) {
                bootbox.alert('Error checking existence of folder:', err1);
            } else {
                bootbox.alert('Error: folder or object already exists at', params.Key);
            }
        });
    };
}

//
// InfoController: code associated with the Info modal where the user can
// view bucket policies, CORS configuration and About text.
//
// Note: do not be tempted to correct the eslint no-unused-vars error
// with SharedService below. Doing so will break injection.
//
// eslint-disable-next-line no-shadow
function InfoController($scope) {
    DEBUG.log('InfoController init');
    window.infoScope = $scope; // for debugging
    $scope.info = {
        cors: null, policy: null, bucket: null, settings: null,
    };

    $scope.$on('broadcastChangeSettings', (e, args) => {
        DEBUG.log('InfoController', 'broadcast change settings bucket:', args.settings.bucket);
        $scope.info.settings = args.settings;
        $scope.info.bucket = args.settings.bucket;
        $scope.getBucketCors(args.settings.bucket);
        $scope.getBucketPolicy(args.settings.bucket);
    });

    $scope.getBucketPolicy = (Bucket) => {
        const params = { Bucket };
        $scope.info.policy = null;
        DEBUG.log('call getBucketPolicy:', Bucket);

        new AWS.S3(AWS.config).getBucketPolicy(params, (err, data) => {
            let text;
            if (err && err.code === 'NoSuchBucketPolicy') {
                DEBUG.log(err);
                text = 'No bucket policy.';
            } else if (err) {
                DEBUG.log(err);
                text = JSON.stringify(err);
            } else {
                DEBUG.log(data.Policy);
                $scope.info.policy = data.Policy;
                DEBUG.log('Info:', $scope.info);
                text = JSON.stringify(JSON.parse(data.Policy.trim()), null, 2);
            }
            $('#info-policy').text(text);
        });
    };

    $scope.getBucketCors = (Bucket) => {
        const params = { Bucket };
        $scope.info.cors = null;
        DEBUG.log('call getBucketCors:', Bucket);

        new AWS.S3(AWS.config).getBucketCors(params, (err, data) => {
            let text;
            if (err && err.code === 'NoSuchCORSConfiguration') {
                DEBUG.log(err);
                text = 'This bucket has no CORS configuration.';
            } else if (err) {
                DEBUG.log(err);
                text = JSON.stringify(err);
            } else {
                DEBUG.log(data.CORSRules);
                [$scope.info.cors] = data.CORSRules;
                DEBUG.log('Info:', $scope.info);
                text = JSON.stringify(data.CORSRules, null, 2);
            }
            $('#info-cors').text(text);
        });
    };
}

//
// SettingsController: code associated with the Settings dialog where the
// user provides credentials and bucket information.
//
// eslint-disable-next-line no-shadow
function SettingsController($scope, SharedService) {
    DEBUG.log('SettingsController init');
    window.settingsScope = $scope; // for debugging

    // Initialized for an unauthenticated user exploring the current bucket
    // TODO: calculate current bucket and initialize below
    $scope.settings = {
        auth: 'anon', region: '', bucket: '', entered_bucket: '', selected_bucket: '', view: 'folder', delimiter: '/', prefix: '',
    };
    $scope.settings.mfa = { use: 'no', code: '' };
    $scope.settings.cred = { accessKeyId: '', secretAccessKey: '', sessionToken: '' };
    $scope.settings.stscred = null;

    // TODO: at present the Settings dialog closes after credentials have been supplied
    // even if the subsequent AWS calls fail with networking or permissions errors. It
    // would be better for the Settings dialog to synchronously make the necessary API
    // calls and ensure they succeed before closing the modal dialog.
    $scope.update = () => {
        DEBUG.log('Settings updated');
        $('#SettingsModal').modal('hide');
        $scope.settings.bucket = $scope.settings.selected_bucket || $scope.settings.entered_bucket;

        // If manually entered bucket then add it to list of buckets for future
        if ($scope.settings.entered_bucket) {
            if (!$scope.settings.buckets) {
                $scope.settings.buckets = [];
            }
            if ($.inArray($scope.settings.entered_bucket, $scope.settings.buckets) === -1) {
                $scope.settings.buckets.push($scope.settings.entered_bucket);
                $scope.settings.buckets = $scope.settings.buckets.sort();
            }
        }

        // If anonymous usage then create empty set of credentials
        if ($scope.settings.auth === 'anon') {
            $scope.settings.cred = { accessKeyId: null, secretAccessKey: null };
        }

        SharedService.changeSettings($scope.settings);
    };
}

//
// UploadController: code associated with the Upload dialog where the
// user reviews the list of dropped files and request upload to S3.
//
// eslint-disable-next-line no-shadow
function UploadController($scope, SharedService) {
    DEBUG.log('UploadController init');
    window.uploadScope = $scope; // for debugging
    $scope.upload = {
        button: null, title: null, files: [], uploads: [],
    };

    // Cache jquery selectors
    const $btnUpload = $('#upload-btn-upload');
    const $btnCancel = $('#upload-btn-cancel');

    // Add new click handler for Cancel button
    $btnCancel.click((e2) => {
        e2.preventDefault();

        // If uploads still in progress then cancel them all
        if ($scope.upload.uploads && $scope.upload.uploads.length > 0) {
            console.log(`Cancel ${$scope.upload.uploads.length} uploads`);
            $scope.upload.uploads.forEach(upl => upl.abort());
            $scope.upload.uploads = [];
        } else {
            console.log('Close upload modal');
            $('#UploadModal').modal('hide');
        }
    });

    //
    // Upload a list of local files to the provided bucket and prefix
    //
    $scope.uploadFiles = (Bucket, prefix) => {
        $scope.$apply(() => {
            $scope.upload.uploads = [];
            $scope.upload.uploading = true;
        });

        DEBUG.log('Dropped files:', $scope.upload.files);

        $scope.upload.files.forEach((file, ii) => {
            DEBUG.log('File:', file);
            DEBUG.log('Index:', ii);

            $(`#upload-td-${ii}`).html(
                `<div class="progress"><span id="upload-td-progress-${ii}" class="progress-bar" data-percent="0">0%</span></div>`,
            );

            const s3 = new AWS.S3(AWS.config);
            const params = {
                Body: file.file, Bucket, Key: (prefix || '') + (file.file.fullPath ? file.file.fullPath : file.file.name), ContentType: file.file.type,
            };

            const upl = s3.upload(params);
            $scope.$apply(() => {
                $scope.upload.uploads.push(upl);
            });

            const funcprogress = (evt) => {
                DEBUG.log('File:', file, 'Part:', evt.part, evt.loaded, 'of', evt.total);
                const pc = evt.total ? ((evt.loaded * 100.0) / evt.total) : 0;
                const pct = Math.round(pc);
                const pcts = `${pct}%`;
                const col = $(`#upload-td-progress-${ii}`);
                col.attr('data-percent', pct);
                col.css('width', pcts).text(pcts);
            };

            const funccancelled = (_file) => {
                const col = $(`#upload-td-progress-${ii}`);
                col.attr('data-percent', 100);
                col.css('width', '100%').text('Cancelled');
                col.addClass('progress-bar-danger');
            };

            const funcsend = (err, data) => {
                let count = $btnUpload.attr('data-filecount');
                DEBUG.log('Upload count was', count, 'now', count - 1);
                $btnUpload.attr('data-filecount', --count);

                if (err) {
                    // AccessDenied is a normal consequence of lack of permission
                    // and we do not treat this as completely unexpected
                    if (err.code === 'AccessDenied') {
                        $(`#upload-td-${ii}`).html('<span class="uploaderror">Access Denied</span>');
                    } else if (err.code === 'RequestAbortedError') {
                        DEBUG.log('Abort upload:', file);
                        funccancelled(file);
                        $btnUpload.hide();
                        $btnCancel.text('Close');
                    } else {
                        DEBUG.log(JSON.stringify(err));
                        $(`#upload-td-${ii}`).html(`<span class="uploaderror">Failed:&nbsp${err.code}</span>`);
                        SharedService.showError(params, err);
                    }
                } else {
                    DEBUG.log('Uploaded', file.file.name, 'to', data.Location);
                    $(`#upload-td-progress-${ii}`).addClass('progress-bar-success');

                    $scope.$apply(() => {
                        $scope.upload.button = `Upload (${count})`;
                        $scope.upload.uploads = $scope.upload.uploads.filter(f => f !== upl);
                    });
                }

                // If all files complete then update buttons and refresh view
                if (count === 0) {
                    $btnUpload.hide();
                    $btnCancel.text('Close');
                    SharedService.viewRefresh();
                }
            };

            // Kick off the upload and report progress
            upl.on('httpUploadProgress', funcprogress).send(funcsend);
        });
    };

    // Wrap readEntries in a promise to make working with readEntries easier
    async function readEntriesPromise(directoryReader) {
        try {
            return new Promise((resolve, reject) => {
                directoryReader.readEntries(resolve, reject);
            });
        } catch (err) {
            DEBUG.log(err);
            return undefined;
        }
    }

    // Get all the entries (files or sub-directories) in a directory
    // by calling readEntries until it returns empty array
    async function readAllDirectoryEntries(directoryReader) {
        const entries = [];
        let readEntries = await readEntriesPromise(directoryReader);
        while (readEntries.length > 0) {
            entries.push(...readEntries);
            // eslint-disable-next-line no-await-in-loop
            readEntries = await readEntriesPromise(directoryReader);
        }
        return entries;
    }

    // Retrieve File object from FileEntry
    async function filePromise(fileEntry) {
        try {
            return new Promise((resolve, reject) => {
                fileEntry.file(resolve, reject);
            });
        } catch (err) {
            DEBUG.log(err);
            return undefined;
        }
    }

    // Get all files recursively
    async function getAllFileEntries(dataTransferItemList) {
        const fileEntries = [];
        const queue = [];
        for (let i = 0; i < dataTransferItemList.length; i++) {
            const dtItem = dataTransferItemList[i];
            queue.push(typeof dtItem.webkitGetAsEntry === 'function' ? dtItem.webkitGetAsEntry() : dtItem.getAsEntry());
        }
        while (queue.length > 0) {
            const entry = queue.shift();
            if (entry) {
                if (entry.isFile) {
                    // eslint-disable-next-line no-await-in-loop
                    const file = await filePromise(entry);
                    file.fullPath = entry.fullPath.substring(1);
                    fileEntries.push(file);
                } else if (entry.isDirectory) {
                    const reader = entry.createReader();
                    // eslint-disable-next-line no-await-in-loop
                    queue.push(...await readAllDirectoryEntries(reader));
                }
            }
        }
        return fileEntries;
    }

    // Wrapper to get files safely
    async function getFilesList(dataTransfer) {
        if (dataTransfer.items.length > 0) {
            if (typeof dataTransfer.items[0].webkitGetAsEntry === 'function' ||
                typeof dataTransfer.items[0].getAsEntry === 'function') {
                return getAllFileEntries(dataTransfer.items);
            }

            DEBUG.log('Cannot do folders upload, falling back to files only');
            return dataTransfer.files;
        }

        return [];
    }

    //
    // Drag/drop handler for files to be uploaded
    //
    $scope.dropZone = (target) => {
        target
            .on('dragover', () => {
                target.addClass('dragover');
                return false;
            })
            .on('dragend dragleave', () => {
                target.removeClass('dragover');
                return false;
            })
            .on('drop', async (e) => {
                DEBUG.log('Dropped files');
                e.stopPropagation();
                e.preventDefault();

                target.removeClass('dragover');

                $bl.addClass('fa-spin');
                const files = SharedService.hasAddedFiles()
                    ? SharedService.getAddedFiles()
                    : await getFilesList(e.originalEvent.dataTransfer);
                $bl.removeClass('fa-spin');

                if (!files.length) {
                    DEBUG.log('Nothing to upload');
                    return false;
                }

                $scope.$apply(() => {
                    $scope.upload.files = [];
                    for (let ii = 0; ii < files.length; ii++) {
                        const fileii = files[ii];

                        // See https://github.com/awslabs/aws-js-s3-explorer/issues/71
                        if (fileii.type || fileii.size % 4096 !== 0 || fileii.size > 1048576) {
                            DEBUG.log('File:', fileii.name, 'Size:', fileii.size, 'Type:', fileii.type);

                            $scope.upload.files.push({
                                file: fileii,
                                name: fileii.fullPath || fileii.name,
                                type: fileii.type,
                                size: bytesToSize(fileii.size),
                                short: path2short(fileii.fullPath || fileii.name),
                            });
                        }
                    }
                });

                const { bucket } = SharedService.getSettings();
                const prefix = SharedService.getViewPrefix();

                // Remove any prior click handler from Upload button
                $btnUpload.unbind('click');

                // Add new click handler for Upload button
                $btnUpload.click((e2) => {
                    e2.preventDefault();
                    $scope.uploadFiles(bucket, prefix);
                });

                // Reset buttons for initial use
                $btnUpload.show();
                $btnCancel.text('Cancel');

                // Bind file count into button
                $btnUpload.attr('data-filecount', files.length);
                $scope.$apply(() => {
                    $scope.upload.title = `${bucket}/${prefix || ''}`;
                    $scope.upload.button = `Upload (${files.length})`;
                    $scope.upload.uploading = false;
                });

                // Reset files selector
                if (SharedService.hasAddedFiles()) {
                    SharedService.resetAddedFiles();
                    $('#addedFiles').val('');
                }

                // Launch the uploader modal
                $('#UploadModal').modal({ keyboard: true, backdrop: 'static' });

                return false;
            });
    };

    // Enable dropzone behavior and highlighting
    $scope.dropZone($('.dropzone'));

    // Simulate drop event on change of files selector
    $('#addedFiles').on('change', (e) => {
        SharedService.addFiles(e.target.files);
        $('.dropzone').trigger('drop');
    });
}

//
// ErrorController: code associated with displaying runtime errors.
//
function ErrorController($scope) {
    DEBUG.log('ErrorController init');
    window.errorScope = $scope; // for debugging
    $scope.error = {
        errors: [], message: '',
    };

    $scope.$on('broadcastError', (e, args) => {
        DEBUG.log('ErrorController', 'broadcast error', args);

        $scope.$apply(() => {
            Object.assign($scope.error, args);
            DEBUG.log('scope errors', $scope.error.errors);
        });

        // Launch the error modal
        $('#ErrorModal').modal({ keyboard: true, backdrop: 'static' });
    });
}

//
// TrashController: code associated with the Trash modal where the user can
// delete objects.
//
// eslint-disable-next-line no-shadow
function TrashController($scope, SharedService) {
    DEBUG.log('TrashController init');
    window.trashScope = $scope; // for debugging
    $scope.trash = { title: null, button: null, objects: [] };

    // Cache jquery selectors
    const $btnDelete = $('#trash-btn-delete');
    const $btnCancel = $('#trash-btn-cancel');

    //
    // Delete a list of objects from the provided S3 bucket
    //
    $scope.deleteFiles = (Bucket, objects, recursion) => {
        DEBUG.log('Delete files:', objects);

        $scope.$apply(() => {
            $scope.trash.trashing = true;
        });

        for (let ii = 0; ii < objects.length; ii++) {
            DEBUG.log('Delete key:', objects[ii].Key);
            DEBUG.log('Object:', objects[ii]);
            DEBUG.log('Index:', ii);

            const s3 = new AWS.S3(AWS.config);

            // If the user is deleting a folder then recursively list
            // objects and delete them
            if (isfolder(objects[ii].Key) && SharedService.getSettings().delimiter) {
                const params = { Bucket, Prefix: objects[ii].Key };
                s3.listObjects(params, (err, data) => {
                    if (err) {
                        if (!recursion) {
                            // AccessDenied is a normal consequence of lack of permission
                            // and we do not treat this as completely unexpected
                            if (err.code === 'AccessDenied') {
                                $(`#trash-td-${ii}`).html('<span class="trasherror">Access Denied</span>');
                            } else {
                                DEBUG.log(JSON.stringify(err));
                                $(`#trash-td-${ii}`).html(`<span class="trasherror">Failed:&nbsp${err.code}</span>`);
                                SharedService.showError(params, err);
                            }
                        } else {
                            DEBUG.log(JSON.stringify(err));
                            SharedService.showError(params, err);
                        }
                    } else if (data.Contents.length > 0) {
                        $scope.deleteFiles(Bucket, data.Contents, true);
                    }
                });
            }

            const params = { Bucket, Key: objects[ii].Key };

            DEBUG.log('Delete params:', params);
            s3.deleteObject(params, (err, _data) => {
                if (err) {
                    if (!recursion) {
                        // AccessDenied is a normal consequence of lack of permission
                        // and we do not treat this as completely unexpected
                        if (err.code === 'AccessDenied') {
                            $(`#trash-td-${ii}`).html('<span class="trasherror">Access Denied</span>');
                        } else {
                            DEBUG.log(JSON.stringify(err));
                            $(`#trash-td-${ii}`).html(`<span class="trasherror">Failed:&nbsp${err.code}</span>`);
                            SharedService.showError(params, err);
                        }
                    } else {
                        DEBUG.log(JSON.stringify(err));
                        SharedService.showError(params, err);
                    }
                } else {
                    DEBUG.log('Deleted', objects[ii].Key, 'from', Bucket);
                    let count = $btnDelete.attr('data-filecount');

                    if (!recursion) {
                        $(`#trash-td-${ii}`).html('<span class="trashdeleted">Deleted</span>');
                        DEBUG.log('Delete count was', count, 'now', count - 1);
                        $btnDelete.attr('data-filecount', --count);
                    }

                    // Update count in Delete button
                    $scope.$apply(() => {
                        $scope.trash.button = `Delete (${count})`;
                    });

                    // If all files deleted then update buttons
                    if (count === 0) {
                        $btnDelete.hide();
                        $btnCancel.text('Close');
                    }

                    // Refresh underlying folder view
                    SharedService.viewRefresh();
                }
            });
        }
    };

    $scope.$on('broadcastTrashObjects', (e, args) => {
        DEBUG.log('TrashController', 'broadcast trash objects', args);

        $scope.trash.objects = [];

        // Populate scope trash object array with objects to be deleted
        for (let ii = 0; ii < args.keys.length; ii++) {
            const obj = args.keys[ii];
            DEBUG.log('Object to be deleted:', obj);

            const object = path2short(isfolder(obj.Key)
                ? prefix2folder(obj.Key)
                : fullpath2filename(obj.Key));

            const folder = path2short(isfolder(obj.Key)
                ? prefix2parentfolder(obj.Key)
                : fullpath2pathname(obj.Key));

            const lastmodified = isfolder(obj.Key)
                ? ''
                : moment(obj.LastModified).fromNow();

            const timestamp = obj.LastModified
                ? moment(obj.LastModified).local().format('YYYY-MM-DD HH:mm:ss')
                : '';

            const objectclass = isfolder(obj.Key)
                ? ''
                : mapStorage[obj.StorageClass];

            const size = isfolder(obj.Key)
                ? ''
                : bytesToSize(obj.Size);

            $scope.trash.objects.push({
                object,
                folder,
                lastmodified,
                timestamp,
                objectclass,
                size,
            });
        }

        // Remove any prior click handler from Delete button
        $btnDelete.unbind('click');

        // Add new click handler for Delete button
        $btnDelete.click((e2) => {
            e2.preventDefault();
            $scope.deleteFiles(args.bucket, args.keys);
        });

        // Reset buttons for initial use
        $btnDelete.show();
        $btnCancel.text('Cancel');

        // Bind file count into button
        $btnDelete.attr('data-filecount', args.keys.length);
        $scope.trash.count = args.keys.length;
        $scope.trash.button = `Delete (${args.keys.length})`;
        $scope.trash.trashing = false;

        $('#TrashModal').modal({ keyboard: true, backdrop: 'static' });
    });
}

// Create Angular module and attach factory and controllers
angular.module('aws-js-s3-explorer', [])
    .factory('SharedService', SharedService)
    .controller('ErrorController', ErrorController)
    .controller('ViewController', ViewController)
    .controller('AddFolderController', AddFolderController)
    .controller('InfoController', InfoController)
    .controller('SettingsController', SettingsController)
    .controller('UploadController', UploadController)
    .controller('TrashController', TrashController);

$(document).ready(() => {
    DEBUG.log('Version jQuery', $.fn.jquery);

    // Default AWS region and v4 signature
    AWS.config.update({ region: '' });
    AWS.config.update({ signatureVersion: 'v4' });

    // Show navbuttons
    $('#navbuttons').removeClass('hidden');

    // Close handler for the alert
    $('[data-hide]').on('click', (e) => {
        $(e.currentTarget).parent().hide();
    });

    // Initialize the moment library (for time formatting utilities) and
    // launch the initial Settings dialog requesting bucket & credentials.
    moment().format();
    $('#SettingsModal').modal({ keyboard: true, backdrop: 'static' });
});
