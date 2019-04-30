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

var s3explorer_columns = { check:0, object:1, folder:2, date:3, timestamp:4, storageclass:5, size:6 };

// Cache frequently-used selectors and data table
var $tb = $('#s3objects-table');
var $bc = $('#breadcrumb');
var $bl = $('#bucket-loader');

// Map S3 storage types to text
var mapStorage = {
    STANDARD: 'Standard',
    STANDARD_IA: 'Standard IA',
    ONEZONE_IA: 'One Zone-IA',
    REDUCED_REDUNDANCY: 'Reduced redundancy',
    GLACIER: 'Glacier',
    INTELLIGENT_TIERING: 'Intelligent Tiering',
    DEEP_ARCHIVE: 'Deep Archive'
};

var app = angular.module('aws-js-s3-explorer', []);

//
// Shared service that all controllers can use
//
app.factory('SharedService', function($rootScope) {
    var shared = { settings: null, viewprefix: null, skew: true };
    DEBUG.log("SharedService init");

    shared.changeSettings = function(settings) {
        DEBUG.log("SharedService::changeSettings");

        var me = this;
        this.settings = settings;
        this.viewprefix = null;
        $.fn.dataTableExt.afnFiltering.length = 0;
        // DEBUG.log("settings.mfa", settings.mfa);
        // DEBUG.log("settings.cred", settings.cred);
        AWS.config.update(settings.cred);
        AWS.config.update({ region: settings.region });

        this.skew && this.correctClockSkew(settings.bucket); this.skew = false;

        if (settings.mfa.use === 'yes') {
            DEBUG.log("listMFADevices");
            var iam = new AWS.IAM();
            iam.listMFADevices({}, function(err, data) {
                if (err) {
                    DEBUG.log("listMFADevices error:", err);
                } else {
                    DEBUG.log("listMFADevices data:", data);

                    var sts = new AWS.STS();
                    var params = {
                        DurationSeconds: 3600,
                        SerialNumber: data.MFADevices[0].SerialNumber,
                        TokenCode: settings.mfa.code
                    };

                    DEBUG.log("getSessionToken params:", params);
                    sts.getSessionToken(params, function(err, data) {
                        if (err) {
                            DEBUG.log("getSessionToken error:", err);
                        } else {
                            DEBUG.log("getSessionToken data:", data);
                            me.settings.stscred = { accessKeyId: data.Credentials.AccessKeyId, secretAccessKey: data.Credentials.SecretAccessKey, sessionToken: data.Credentials.SessionToken };
                            AWS.config.update(me.settings.stscred);
                            $rootScope.$broadcast('broadcastChangeSettings', { settings: me.settings });
                        }
                    });
                }
            });
        } else {
            $rootScope.$broadcast('broadcastChangeSettings', { settings: settings });
        }
    };

    shared.changeViewPrefix = function(prefix) {
        DEBUG.log("SharedService::changeViewPrefix");

        // Presence of delimiter indicates folder-level view
        if (this.settings.delimiter) {
            this.settings.prefix = prefix;
            this.viewprefix = null;
            $.fn.dataTableExt.afnFiltering.length = 0;
            $rootScope.$broadcast('broadcastChangePrefix', { prefix: prefix });
        // Else bucket-level view
        } else {
            this.viewprefix = prefix;
            $rootScope.$broadcast('broadcastChangePrefix', { viewprefix: prefix });
        }
    };

    shared.getViewPrefix = function() {
        return this.viewprefix || this.settings.prefix;
    };

    shared.viewRefresh = function() {
        $rootScope.$broadcast('broadcastViewRefresh');
    };

    shared.trashObjects = function(bucket, keys) {
        $rootScope.$broadcast('broadcastTrashObjects', { bucket: bucket, keys: keys });
    };

    shared.addFolder = function(bucket, folder) {
        $rootScope.$broadcast('broadcastViewRefresh');
    };

    // We use pre-signed URLs so that the user can securely download
    // objects. For security reasons, we make these URLs time-limited and in
    // order to do that we need the client's clock to be in sync with the AWS
    // S3 endpoint otherwise we might create URLs that are immediately invalid,
    // for example if the client's browser time is 55 minutes behind S3's time.
    shared.correctClockSkew = function(bucket) {
        var s3 = new AWS.S3();
        DEBUG.log("Invoke headBucket:", bucket);

        // Head the bucket to get a Date response. The 'date' header will need
        // to be exposed in S3 CORS configuration.
        s3.headBucket({Bucket: bucket, RequestPaymentConfiguration: { Payer: 'Requester' }}, function(err, data) {
            if (err) {
                DEBUG.log("headBucket error:", err);
            } else {
                DEBUG.log("headBucket data:", JSON.stringify(data));
                DEBUG.log("headBucket headers:", JSON.stringify(this.httpResponse.headers));

                if (this.httpResponse.headers.date) {
                    var date = Date.parse(this.httpResponse.headers.date);
                    DEBUG.log("headers date:", date);
                    AWS.config.systemClockOffset = new Date() - date;
                    DEBUG.log("clock offset:", AWS.config.systemClockOffset);
                    // Can now safely generate presigned urls
                }
            }
        });
    };

    return shared;
});

//
// ViewController: code associated with the main S3 Explorer table that shows
// the contents of the current bucket/folder and allows the user to downloads
// files, delete files, and do various other S3 functions.
//
app.controller('ViewController', function($scope, SharedService) {

    DEBUG.log("ViewController init");
    window.viewScope = $scope; // for debugging
    $scope.view = { bucket: null, prefix: null, settings: null, objectCount: 0, keys_selected: [] };
    $scope.stop = false;

    // Delegated event handler for S3 object/folder clicks. This is delegated
    // because the object/folder rows are added dynamically and we do not want
    // to have to assign click handlers to each and every row.
    $tb.on('click', 'a', function(event) {
        event.preventDefault();
        var target = event.target;
        DEBUG.log("target href=" + target.href);
        DEBUG.log("target dataset=" + JSON.stringify(target.dataset));

        // If the user has clicked on a folder then navigate into that folder
        if (target.dataset.s3 === "folder") {
            SharedService.changeViewPrefix(target.dataset.s3key);
        // Else user has clicked on an object so download it in new window/tab
        } else {
            if ($scope.view.settings.auth === 'anon') {
                window.open(target.href, '_blank');
            } else {
                var s3 = new AWS.S3();
                var params = {Bucket: $scope.view.settings.bucket, Key: target.dataset.s3key, Expires: 15,  RequestPayer: 'requester'};

                DEBUG.log("params:", params);
                s3.getSignedUrl('getObject', params, function (err, url) {
                    if (err) {
                        DEBUG.log("err:", err);
                        showError([params, err]);
                    } else {
                        DEBUG.log("url:", url);
                        window.open(url, '_blank');
                    }
                });
            }
        }
        return false;
    });

    // Delegated event handler for breadcrumb clicks.
    $bc.on('click', 'a', function(event) {
        DEBUG.log("breadcrumb li click");
        event.preventDefault();
        var target = event.target;
        DEBUG.log("target dataset=" + JSON.stringify(target.dataset));
        SharedService.changeViewPrefix(target.dataset.prefix);
        return false;
    });

    $scope.$on('broadcastChangeSettings', function(e, args) {
        DEBUG.log('ViewController', 'broadcast change settings:', args.settings);
        $scope.view.objectCount = 0;
        $scope.view.settings = args.settings;
        $scope.refresh();
    });

    $scope.$on('broadcastChangePrefix', function(e, args) {
        DEBUG.log('ViewController', 'broadcast change prefix args:', args);
        $scope.$apply(function() {
            // Create breadcrumbs from current path (S3 bucket plus folder hierarchy)
            $scope.folder2breadcrumbs($scope.view.settings.bucket, args.viewprefix || args.prefix);

            // In bucket-level view we already have the data so we just need to
            // filter it on prefix.
            if (args.viewprefix !== undefined && args.viewprefix !== null) {
                $.fn.dataTableExt.afnFiltering.length = 0;

                // Closure to enclose view prefix
                (function(viewprefix) {
                    $.fn.dataTableExt.afnFiltering.push(
                        // Filter function returns true to include item in view
                        function(oSettings, aData, iDataIndex) {
                            // DEBUG.log('filter', viewprefix, aData[1], (viewprefix && aData[1] !== viewprefix && aData[1].startsWith(viewprefix)));
                            return aData[1] !== viewprefix && aData[1].startsWith(viewprefix);
                        }
                    );
                })(args.viewprefix);

                // Re-draw the table
                $('#s3objects-table').DataTable().draw();
            // In folder-level view, we actually need to query the data for the
            // the newly-selected folder.
            } else {
                $.fn.dataTableExt.afnFiltering.length = 0;
                $scope.view.settings.prefix = args.prefix;
                $scope.refresh();
            }
        });
    });

    $scope.$on('broadcastViewRefresh', function() {
        DEBUG.log('ViewController', 'broadcast view refresh');
        $scope.$apply(function() {
            $scope.refresh();
        });
    });

    $scope.renderObject = function(data, type, full) {
        // DEBUG.log("renderObject:", JSON.stringify(full));
        if (full.CommonPrefix) {
            // DEBUG.log("is folder: " + data);
            if ($scope.view.settings.prefix) {
                return '<a data-s3="folder" data-s3key="' + data + '" href="' + object2hrefvirt($scope.view.settings.bucket, data) + '">' + prefix2folder(data) + '</a>';
            } else {
                return '<a data-s3="folder" data-s3key="' + data + '" href="' + object2hrefvirt($scope.view.settings.bucket, data) + '">' + data + '</a>';
            }
        } else {
            // DEBUG.log("not folder: " + data);
            return '<a data-s3="object" data-s3key="' + data + '" href="' + object2hrefvirt($scope.view.settings.bucket, data) + '"download="' + fullpath2filename(data) + '">' + fullpath2filename(data) + '</a>';
        }
    };

    $scope.renderFolder = function(data, type, full) {
        return full.CommonPrefix ? "" : fullpath2pathname(data);
    };

    $scope.progresscb = function(objects, folders) {
        DEBUG.log('ViewController', 'Progress cb objects:', objects);
        DEBUG.log('ViewController', 'Progress cb folders:', folders);
        $scope.$apply(function() {
            $scope.view.objectCount += objects + folders;
        });
    };

    $scope.refresh = function() {
        DEBUG.log('refresh');
        if ($scope.running()) {
            DEBUG.log('running, stop');
            $scope.listobjectsstop();
        } else {
            DEBUG.log('refresh', $scope.view.settings);
            $scope.view.objectCount = 0;
            $scope.folder2breadcrumbs($scope.view.settings.bucket, SharedService.getViewPrefix());
            $scope.listobjects($scope.view.settings.bucket, $scope.view.settings.prefix, $scope.view.settings.delimiter);
        }
    };

    $scope.trash = function() {
        DEBUG.log('Trash:', $scope.view.keys_selected);
        if ($scope.view.keys_selected.length > 0) {
          SharedService.trashObjects($scope.view.settings.bucket, $scope.view.keys_selected);
        }
    };

    $scope.running = function() {
        return $bl.hasClass('fa-spin');
    };

    $scope.folder2breadcrumbs = function(bucket, prefix) {
        DEBUG.log('Breadcrumbs bucket: ' + bucket);
        DEBUG.log('Breadcrumbs prefix: ' + prefix);

        // Empty the current breadcrumb list
        $('#breadcrumb li').remove();

        // This array will contain the needed prefixes for each folder level.
        var prefixes = [''];
        var buildprefix = '';

        if (prefix) {
            prefixes.push.apply(prefixes, prefix.endsWith('/') ? prefix.slice(0, -1).split('/') : prefix.split('/'));
        }

        // Add bucket followed by prefix segments to make breadcrumbs
        for (var ii = 0; ii < prefixes.length; ii++) {
            var li;

            // Bucket
            if (ii === 0) {
                var a1 = $('<a>').attr('href', '#').text(bucket);
                li = $('<li>').append(a1);
            // Followed by n - 1 intermediate folders
            } else if (ii < prefixes.length - 1) {
                var a2 = $('<a>').attr('href', '#').text(prefixes[ii]);
                li = $('<li>').append(a2);
            // Followed by current folder
            } else {
                li = $('<li>').text(prefixes[ii]);
            }

            // Accumulate prefix
            if (ii) {
                buildprefix += prefixes[ii] + '/';
            }

            // Save prefix & bucket data for later click handler
            li.children('a').attr('data-prefix', buildprefix).attr('data-bucket', bucket);

            // Add to breadcrumbs
            $bc.append(li);
        }

        // Make last breadcrumb active
        $('#breadcrumb li:last').addClass('active');
    };

    $scope.listobjectsstop = function(stop) {
        DEBUG.log('ViewController', 'listobjectsstop:', stop || true);
        $scope.stop = stop || true;
    };

    // This is the listObjects callback
    $scope.listobjectscb = function(err, data) {
        DEBUG.log("Enter listobjectscb");
        if (err) {
            DEBUG.log('Error: ' + JSON.stringify(err));
            DEBUG.log('Error: ' + err.stack);
            $bl.removeClass('fa-spin');
            showError([{ bucket: $scope.view.bucket, prefix: $scope.view.prefix}, err]);
        } else {
            var marker;

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

            var count = { objects: 0, folders: 0 };

            // NOTE: folders are returned in CommonPrefixes if delimiter is
            // supplied on the listObjects call and in Contents if delimiter
            // is not supplied on the listObjects call, so we may need to
            // source our DataTable folders from Contents or CommonPrefixes.
            // DEBUG.log("Contents", data.Contents);
            $.each(data.Contents, function(index, value) {
                if (value.Key === data.Prefix) {
                    // ignore this folder
                } else if (isfolder(value.Key)) {
                    $tb.DataTable().row.add({CommonPrefix: true, Key: value.Key, StorageClass: null});
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
            $.each(data.CommonPrefixes, function(index, value) {
                $tb.DataTable().rows.add([{CommonPrefix: true, Key: value.Prefix, StorageClass: null}]);
                count.objects++;
            });

            // Re-draw the table
            $tb.DataTable().draw();

            // Make progress callback to report objects read so far
            $scope.progresscb(count.objects, count.folders);

            var params = { Bucket: data.Name, Prefix: data.Prefix, Delimiter: data.Delimiter, Marker: marker, RequestPayer: 'requester'};

            // DEBUG.log("AWS.config:", JSON.stringify(AWS.config));

            if ($scope.stop) {
                DEBUG.log('Bucket ' + data.Name + ' stopped');
                $bl.removeClass('fa-spin');
            } else if (data.IsTruncated) {
                DEBUG.log('Bucket ' + data.Name + ' truncated');
                var s3 = new AWS.S3(AWS.config);
                if (AWS.config.credentials && AWS.config.credentials.accessKeyId) {
                    DEBUG.log('Make S3 authenticated call to listObjects');
                    s3.listObjects(params, $scope.listobjectscb);
                } else {
                    DEBUG.log('Make S3 unauthenticated call to listObjects');
                    s3.makeUnauthenticatedRequest('listObjects', params, $scope.listobjectscb);
                }
            } else {
                DEBUG.log('Bucket ' + data.Name + ' listing complete');
                $bl.removeClass('fa-spin');
            }
        }
    };

    // Start the spinner, clear the table, make an S3 listObjects request
    $scope.listobjects = function(bucket, prefix, delimiter, marker) {
        DEBUG.log("Enter listobjects");

        // If this is the initial listObjects
        if (!marker) {

            // Checked on each event cycle to stop list prematurely
            $scope.stop = false;

            // Start spinner and clear table
            $scope.view.keys_selected = [];
            $bl.addClass('fa-spin');
            $tb.DataTable().clear();
            $tb.DataTable().column(s3explorer_columns.folder).visible(!delimiter);
        }

        var s3 = new AWS.S3(AWS.config);
        var params = { Bucket: bucket, Prefix: prefix, Delimiter: delimiter, Marker: marker, RequestPayer: 'requester'};

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

    isfolder = function(path) {
        return path.endsWith('/');
    };

    // Individual render functions so that we can control how column data appears
    renderSelect = function(data, type, full) {
        return (type == 'display' && !full.CommonPrefix) ? '<span class="text-center"><input type="checkbox"></span>' : '';
    };

    renderObject = function(data, type, full) {
        return (type == 'display') ? $scope.renderObject(data, type, full) : data;
    };

    renderFolder = function(data, type, full) {
        return $scope.renderFolder(data, type, full);
    };

    renderLastModified = function(data, type, full) {
        return data ? moment(data).fromNow() : "";
    };

    renderTimestamp = function(data, type, full) {
        return data ? moment(data).local().format('YYYY-MM-DD HH:mm:ss') : "";
    };

    renderStorageClass = function(data, type, full) {
        return data ? mapStorage[data] : '';
    };

    // Object sizes are displayed in nicer format e.g. 1.2 MB but are otherwise
    // handled as simple number of bytes e.g. for sorting purposes
    dataSize = function(source, type, val) {
        return source.Size ? ((type == 'display') ? bytesToSize(source.Size) : source.Size) : "";
    };

    // Initial DataTable settings (must only do this one time)
    $('#s3objects-table').DataTable({
        iDisplayLength: 25,
        order: [[2, 'asc'], [1, 'asc']],
        aoColumnDefs: [
            { "aTargets": [0], "mData": null, "mRender": renderSelect, "sClass": "text-center", "sWidth": "20px", "bSortable": false },
            { "aTargets": [1], "mData": "Key", "mRender": renderObject, "sType": "key" },
            { "aTargets": [2], "mData": "Key", "mRender": renderFolder },
            { "aTargets": [3], "mData": "LastModified", "mRender": renderLastModified },
            { "aTargets": [4], "mData": "LastModified", "mRender": renderTimestamp },
            { "aTargets": [5], "mData": "StorageClass", "mRender": renderStorageClass },
            { "aTargets": [6], "mData": dataSize },
        ]
    });

    // Custom ascending sort for Key column so folders appear before objects
    $.fn.dataTableExt.oSort['key-asc']  = function(a,b) {
        var x = (isfolder(a) ? "0-" + a : "1-" + a).toLowerCase();
        var y = (isfolder(b) ? "0-" + b : "1-" + b).toLowerCase();
        return ((x < y) ? -1 : ((x > y) ?  1 : 0));
    };

    // Custom descending sort for Key column so folders appear before objects
    $.fn.dataTableExt.oSort['key-desc'] = function(a,b) {
        var x = (isfolder(a) ? "1-" + a : "0-" + a).toLowerCase();
        var y = (isfolder(b) ? "1-" + b : "0-" + b).toLowerCase();
        return ((x < y) ? 1 : ((x > y) ? -1 : 0));
    };

    // Handle click on selection checkbox
    $('#s3objects-table tbody').on('click', 'input[type="checkbox"]', function(e) {
        var $row = $(this).closest('tr');
        var data = $('#s3objects-table').DataTable().row($row).data();
        var index = -1;

        // Find matching key in currently checked rows
        $.each($scope.view.keys_selected, function(i, item) {
            if (item.Key === data.Key) {
                index = i;
                return false;
            }
        });

        // Remove or add checked row as appropriate
        if (this.checked && index === -1) {
            $scope.view.keys_selected.push(data);
        } else if (!this.checked && index !== -1){
            $scope.view.keys_selected.splice(index, 1);
        }

        $scope.$apply(function() {
            // Doing this to force Angular to update models
            DEBUG.log("Selected rows:", $scope.view.keys_selected);
        });

        if (this.checked){
            $row.addClass('selected');
        } else {
            $row.removeClass('selected');
        }

        // Prevent click event from propagating to parent
        e.stopPropagation();
   });

    // Handle click on table cells
    $('#s3objects-table tbody').on('click', 'td', function(e) {
        $(this).parent().find('input[type="checkbox"]').trigger('click');
    });
});

//
// AddFolderController: code associated with the add folder function.
//
app.controller('AddFolderController', function($scope, SharedService) {

    DEBUG.log("AddFolderController init");
    $scope.add_folder = {  settings: null, bucket: null, entered_folder: '', view_prefix: '/' };
    window.addFolderScope = $scope; // for debugging
    DEBUG.log('AddFolderController add_folder init', $scope.add_folder);

    $scope.$on('broadcastChangeSettings', function(e, args) {
        DEBUG.log('AddFolderController', 'broadcast change settings bucket:', args.settings.bucket);
        $scope.add_folder.settings = args.settings;
        $scope.add_folder.bucket = args.settings.bucket;
        DEBUG.log('AddFolderController add_folder bcs', $scope.add_folder);
    });

    $scope.$on('broadcastChangePrefix', function(e, args) {
        DEBUG.log('AddFolderController', 'broadcast change prefix args:', args);
        $scope.add_folder.view_prefix = args.prefix || args.viewprefix || '/';
        DEBUG.log('AddFolderController add_folder bcp', $scope.add_folder);
    });

    $scope.addFolder = function() {
        DEBUG.log('Add folder');
        DEBUG.log('Current prefix:', $scope.add_folder.view_prefix);

        var folder = stripLeadTrailSlash($scope.add_folder.view_prefix + stripLeadTrailSlash($scope.add_folder.entered_folder)) + '/';
        DEBUG.log('Calculated folder:', folder);

        var s3 = new AWS.S3(AWS.config);
        var params = {Bucket: $scope.add_folder.bucket, Key: folder, RequestPayer: 'requester'};

        DEBUG.log("Invoke headObject:", params);

        // Test if an object with this key already exists
        s3.headObject(params, function(err, data) {
            if (err && err.code === 'NotFound') {
                DEBUG.log("Invoke putObject:", params);

                // Create a zero-sized object to simulate a folder
                s3.putObject(params, function(err, data) {
                    if (err) {
                        DEBUG.log("putObject error:", err);
                        bootbox.alert("Error creating folder: " + err);
                    } else {
                        SharedService.addFolder(params.Bucket, params.Key);
                        $('#AddFolderModal').modal('hide');
                        $scope.add_folder.entered_folder = '';
                    }
                });
            } else if (err) {
                bootbox.alert("Error checking existence of folder: " + err);
            } else {
                bootbox.alert("Error: folder or object already exists at " + params.Key);
            }
        });
    };
});

//
// InfoController: code associated with the Info modal where the user can
// view bucket policies, CORS configuration and About text.
//
app.controller('InfoController', function($scope, SharedService) {

    DEBUG.log("InfoController init");
    window.infoScope = $scope; // for debugging
    $scope.info = { cors: null, policy: null, bucket: null, settings: null };

    $scope.$on('broadcastChangeSettings', function(e, args) {
        DEBUG.log('InfoController', 'broadcast change settings bucket:', args.settings.bucket);
        $scope.info.settings = args.settings;
        $scope.info.bucket = args.settings.bucket;
        $scope.getBucketCors(args.settings.bucket);
        $scope.getBucketPolicy(args.settings.bucket);
    });

    $scope.getBucketPolicy = function(bucket) {
        var params = {Bucket: bucket};
        // TODO : check if AWS.s3.getBucketPolicy() needs RequesterPayer - it seems it doesn't
        // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getBucketPolicy-property

        $scope.info.policy = null;
        DEBUG.log('call getBucketPolicy:', bucket);

        new AWS.S3(AWS.config).getBucketPolicy(params, function (err, data) {
            var text;
            if (err && err.code === 'NoSuchBucketPolicy') {
                DEBUG.log(err);
                text = "No bucket policy.";
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

    $scope.getBucketCors = function(bucket) {
        var params = {Bucket: bucket};

        // TODO : check if AWS.s3.getBucketCors() needs RequesterPayer - it seems it doesn't
        // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#getBucketPolicy-property

        $scope.info.cors = null;
        DEBUG.log('call getBucketCors:', bucket);

        new AWS.S3(AWS.config).getBucketCors(params, function (err, data) {
            var text;
            if (err && err.code === 'NoSuchCORSConfiguration') {
                DEBUG.log(err);
                text = "This bucket has no CORS configuration.";
            } else if (err) {
                DEBUG.log(err);
                text = JSON.stringify(err);
            } else {
                DEBUG.log(data.CORSRules);
                $scope.info.cors = data.CORSRules[0];
                DEBUG.log('Info:', $scope.info);
                text = JSON.stringify(data.CORSRules, null, 2);
            }
            $('#info-cors').text(text);
        });
    };
});

//
// SettingsController: code associated with the Settings dialog where the
// user provides credentials and bucket information.
//
app.controller('SettingsController', function($scope, SharedService) {

    DEBUG.log("SettingsController init");
    window.settingsScope = $scope; // for debugging

    // Initialized for an unauthenticated user exploring the current bucket
    // TODO: calculate current bucket and initialize below
    $scope.settings = { auth: 'anon', region: '', bucket: '', entered_bucket: '', selected_bucket: '', view: 'folder', delimiter: '/', prefix: '' };
    $scope.settings.mfa = { use: 'no', code: '' };
    $scope.settings.cred = { accessKeyId: '', secretAccessKey: '', sessionToken: '' };
    $scope.settings.stscred = null;
    $scope.settings.requestpayer = null;

    // TODO: at present the Settings dialog closes after credentials have been supplied
    // even if the subsequent AWS calls fail with networking or permissions errors. It
    // would be better for the Settings dialog to synchronously make the necessary API
    // calls and ensure they succeed before closing the modal dialog.
    $scope.update = function() {
        DEBUG.log("Settings updated");
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
});

//
// UploadController: code associated with the Upload dialog where the
// user reviews the list of dropped files and request upload to S3.
//
app.controller('UploadController', function($scope, SharedService) {

    DEBUG.log("UploadController init");
    window.uploadScope = $scope; // for debugging
    $scope.upload = { button: null, title: null };

    //
    // Upload a list of local files to the provided bucket and prefix
    //
    $scope.uploadFiles = function(s3bucket, prefix, droppedFiles) {
        $scope.$apply(function() {
            $scope.upload.uploading = true;
        });

        // DEBUG.log("Dropped files:", droppedFiles);
        for (var ii = 0; ii < droppedFiles.length; ii++) {
            DEBUG.log("Upload index:", droppedFiles[ii].index);

            // Closure needed to enclose the saved file and index
            (function(s3bucket, file, index) {
                DEBUG.log("File:", file);
                DEBUG.log("Index:", index);

                $('#upload-td-' + index).html('<div class="progress"><span id="upload-td-progress-' + index + '"' + ' class="progress-bar" style="min-width: 25px; width: 0%;" data-percent="0">0%</span></div>');

                var s3 = new AWS.S3(AWS.config);
                var params = {Body: file.file, Bucket: s3bucket, Key: (prefix ? prefix : '') + droppedFiles[index].file.name, ContentType: droppedFiles[index].file.type,  RequestPayer: 'requester'};

                DEBUG.log("Upload params:", params);
                s3.upload(params)
                    .on('httpUploadProgress', function(evt) {
                        // DEBUG.log('Part:' + evt.part, evt.loaded, evt.total);
                        var pc = evt.total ? ((evt.loaded * 100.0) / evt.total) : 0;
                        var pct = Math.round(pc);
                        var pcts = '' + pct + '%';
                        var col = $('#upload-td-progress-' + index);
                        col.attr('data-percent', pct);
                        col.css('width', pcts).text(pcts);
                    })
                    .send(function(err, data) {
                        if (err) {
                            // AccessDenied is a normal consequence of lack of permission
                            // and we do not treat this as completely unexpected
                            if (err.code === 'AccessDenied') {
                                $('#upload-td-' + index).html('<span class="uploaderror">Access Denied</span>');
                            } else {
                                DEBUG.log(JSON.stringify(err));
                                $('#upload-td-' + index).html('<span class="uploaderror">Failed:&nbsp' + err.code + '</span>');
                                showError([params, err]);
                            }
                        } else {
                            DEBUG.log("Uploaded", file.file.name, "to", data.Location);
                            var count = $('#upload-btn-upload').attr('data-filecount');
                            $('#upload-btn-upload').attr('data-filecount', --count);
                            $('#upload-td-progress-' + index).addClass('progress-bar-success');

                            $scope.$apply(function() {
                                $scope.upload.button = 'Upload (' + count + ')';
                           });

                            // If all files uploaded then refresh underlying folder view
                            if (count === 0) {
                                $('#upload-btn-upload').hide();
                                $('#upload-btn-cancel').text('Close');
                                SharedService.viewRefresh();
                            }
                        }
                    });

            })(s3bucket, droppedFiles[ii], ii);
        }
    };

    //
    // Drag/drop handler for files to be uploaded
    //
    $scope.dropZone = function(target) {
        target
            .on('dragover', function() {
                target.addClass('dragover');
                return false;
            })
            .on('dragend dragleave', function() {
                target.removeClass('dragover');
                return false;
            })
            .on('drop', function(e) {
                DEBUG.log('Dropped files');
                e.stopPropagation();
                e.preventDefault();
                target.removeClass('dragover');
                $('#upload-tbody tr').remove();

                var droppedFiles = [];
                var fileIndex = droppedFiles.length;
                var files = e.originalEvent.dataTransfer.files;

                for (var ii = 0; ii < files.length; ii++) {
                    var fileii = files[ii];
                    if (fileii.type || fileii.size % 4096 !== 0 || fileii.size > 1048576) {
                        var thisfile = { file: fileii, complete: false, index: fileIndex++ };
                        droppedFiles.push(thisfile);
                        DEBUG.log("File:", fileii.name, "Size:", fileii.size, "Type:", fileii.type);

                        var td = [
                            $('<td>').append(ii+1),
                            $('<td>').append(fileii.name),
                            $('<td>').append(fileii.type),
                            $('<td>').append(bytesToSize(fileii.size)),
                            $('<td>').attr('id', 'upload-td-' + ii).append($('<i>').append('n/a'))
                        ];

                        var tr = $('<tr>').attr('id', 'upload-tr-' + ii);
                        tr.append(td[0]).append(td[1]).append(td[2]).append(td[3]).append(td[4]);
                        $('#upload-tbody').append(tr);
                    } else {
                        DEBUG.log('Possible folder', fileii.name);
                        // showError('Sorry, you must drop files, not folders');
                    }
                }

                var bucket = SharedService.settings.bucket;
                var prefix = SharedService.getViewPrefix();

                // Closure needed to enclose the S3 bucket, prefix and files
                (function(bucket, prefix, files) {
                    // Remove any prior click handler from Upload button
                    $('#upload-btn-upload').unbind('click');

                    // Add new click handler for Upload button
                    $('#upload-btn-upload').click(function(e) {
                        e.preventDefault();
                        $scope.uploadFiles(bucket, prefix, files);
                    });
                })(bucket, prefix, droppedFiles);

                // Reset buttons for initial use
                $('#upload-btn-upload').show();
                $('#upload-btn-cancel').text('Cancel');

                // Bind file count into button
                $('#upload-btn-upload').attr('data-filecount', files.length);
                $scope.$apply(function() {
                    $scope.upload.title = bucket + '/' + (prefix ? prefix : '');
                    $scope.upload.button = 'Upload (' + files.length + ')';
                    $scope.upload.uploading = false;
               });

                // Launch the uploader modal
                $('#UploadModal').modal({ keyboard: true, backdrop: 'static' });
            });
    };

    // Enable dropzone behavior and highlighting
    $scope.dropZone($('.dropzone'));
});

//
// TrashController: code associated with the Trash modal where the user can
// delete objects.
//
app.controller('TrashController', function($scope, SharedService) {
    DEBUG.log("TrashController init");
    window.trashScope = $scope; // for debugging
    $scope.trash = { title: null, button: null };

    //
    // Delete a list of objects from the provided S3 bucket
    //
    $scope.deleteFiles = function(s3bucket, objects) {
        DEBUG.log("Delete files:", objects);

        $scope.$apply(function() {
            $scope.trash.trashing = true;
        });

        for (var ii = 0; ii < objects.length; ii++) {
            DEBUG.log("Delete key:", objects[ii].Key);

            // Closure needed to enclose the saved file and index
            (function(s3bucket, object, index) {
                DEBUG.log("Object:", object);
                DEBUG.log("Index:", index);

                var s3 = new AWS.S3(AWS.config);
                var params = {Bucket: s3bucket, Key: object.Key, RequestPayer: 'requester'};

                DEBUG.log("Delete params:", params);
                s3.deleteObject(params, function(err, data) {
                    if (err) {
                        // AccessDenied is a normal consequence of lack of permission
                        // and we do not treat this as completely unexpected
                        if (err.code === 'AccessDenied') {
                            $('#trash-td-' + index).html('<span class="trasherror">Access Denied</span>');
                        } else {
                            DEBUG.log(JSON.stringify(err));
                            $('#trash-td-' + index).html('<span class="trasherror">Failed:&nbsp' + err.code + '</span>');
                            showError([params, err]);
                        }
                    } else {
                        DEBUG.log("Deleted", object.Key, "from", s3bucket);
                        var count = $('#trash-btn-delete').attr('data-filecount');
                        $('#trash-td-' + index).html('<span class="trashdeleted">Deleted</span>');
                        $('#trash-btn-delete').attr('data-filecount', --count);
                        // $('#trash-btn-delete').text('Delete (' + count + ')');
                        $scope.$apply(function() {
                            $scope.trash.button = 'Delete (' + count + ')';
                        });

                        // If all files deleted then refresh underlying folder view
                        if (count === 0) {
                            $('#trash-btn-delete').hide();
                            $('#trash-btn-cancel').text('Close');
                            SharedService.viewRefresh();
                        }
                    }
                });

            })(s3bucket, objects[ii], ii);
        }
    };

    $scope.$on('broadcastTrashObjects', function(e, args) {
        DEBUG.log('TrashController', 'broadcast trash objects', args);

        $('#trash-tbody tr').remove();

        for (var ii = 0; ii < args.keys.length; ii++) {
            var obj = args.keys[ii];
            DEBUG.log("Object to be deleted:", obj);

            var td = [
                $('<td>').append(ii+1),
                $('<td>').append(fullpath2filename(obj.Key)),
                $('<td>').append(fullpath2pathname(obj.Key)),
                $('<td>').append(moment(obj.LastModified).fromNow()),
                $('<td>').append(obj.LastModified ? moment(obj.LastModified).local().format('YYYY-MM-DD HH:mm:ss') : ""),
                $('<td>').append(mapStorage[obj.StorageClass]),
                $('<td>').append(bytesToSize(obj.Size)),
                $('<td>').attr('id', 'trash-td-' + ii).append($('<i>').append('n/a'))
            ];

            var tr = $('<tr>').attr('id', 'trash-tr-' + ii);
            tr.append(td[0]).append(td[1]).append(td[2]).append(td[3]).append(td[4]).append(td[5]).append(td[6]).append(td[7]);
            $('#trash-tbody').append(tr);
        }

        // Closure needed to enclose the S3 bucket and list of object keys
        (function(bucket, keys) {
            // Remove any prior click handler from Delete button
            $('#trash-btn-delete').unbind('click');

            // Add new click handler for Delete button
            $('#trash-btn-delete').click(function(e) {
                e.preventDefault();
                $scope.deleteFiles(bucket, keys);
            });
        })(args.bucket, args.keys);

        // Reset buttons for initial use
        $('#trash-btn-delete').show();
        $('#trash-btn-cancel').text('Cancel');

        // Bind file count into button
        $('#trash-btn-delete').attr('data-filecount', args.keys.length);
        // $scope.$apply(function() {
            $scope.trash.count = args.keys.length;
            $scope.trash.button = 'Delete (' + args.keys.length + ')';
            $scope.trash.trashing = false;
        // });

        $('#TrashModal').modal({ keyboard: true, backdrop: 'static' });
    });
});

// Debug utility to complement console.log
var DEBUG = (function() {
    var timestamp = function() {};
    timestamp.toString = function() {
        return "[DEBUG " + moment().format() + "]";
    };

    return {
        log: console.log.bind(console, '%s', timestamp)
    };
})();

// Utility to convert bytes to readable text e.g. "2 KB" or "5 MB"
function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    var ii = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, ii), 2) + ' ' + sizes[ii];
}

// Custom startsWith function for String (based on ECMAScript 2015 (ES6) standard)
if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(searchString, position) {
        position = position || 0;
        return this.indexOf(searchString, position) === position;
    };
}

// Custom endsWith function for String (based on ECMAScript 2015 (ES6) standard)
if (!String.prototype.endsWith) {
    String.prototype.endsWith = function(searchString, position) {
        var subjectString = this.toString();
        if (position === undefined || position > subjectString.length) {
            position = subjectString.length;
        }
        position -= searchString.length;
        var lastIndex = subjectString.indexOf(searchString, position);
        return lastIndex !== -1 && lastIndex === position;
    };
}

// Convert cars/vw/golf.png to golf.png
function fullpath2filename(path) {
    return path.replace(/^.*[\\\/]/, '');
}

// Convert cars/vw/golf.png to cars/vw
function fullpath2pathname(path) {
    var index = path.lastIndexOf('/');
    return index === -1 ? '/' : path.substring(0, index + 1);
}

// Convert cars/vw/ to vw/
function prefix2folder(prefix) {
    var parts = prefix.split('/');
    return parts[parts.length-2] + '/';
}

// Convert cars/vw/sedans/ to cars/vw/
function prefix2parentfolder(prefix) {
    var parts = prefix.split('/');
    parts.splice(parts.length - 2, 1);
    return parts.join('/');
}

// Virtual-hosted-style URL, ex: https://mybucket1.s3.amazonaws.com/index.html
function object2hrefvirt(bucket, key) {
    var enckey = key.split('/').map(function(x) { return encodeURIComponent(x); }).join('/');
    return document.location.protocol + '//' + bucket + '.s3.amazonaws.com/' + enckey;
}

// Path-style URLs, ex: https://s3.amazonaws.com/mybucket1/index.html
function object2hrefpath(bucket, key) {
    var enckey = key.split('/').map(function(x) { return encodeURIComponent(x); }).join('/');
    return document.location.protocol + "//s3.amazonaws.com/" + bucket + "/" + enckey;
}

function isfolder(path) {
    return path.endsWith('/');
}

function stripLeadTrailSlash(s) {
    while (s.startsWith('/')) s = s.substring(1);
    while (s.endsWith('/')) s = s.substring(0, s.length - 1);
    return s;
}

function showError(objects) {
    $('#alert-tbody tr').remove();

    for (var ii = 0; ii < objects.length; ii++) {
        for (var prop in objects[ii]) {
            DEBUG.log('prop', prop);
            var obj = objects[ii][prop] || 'n/a';
        var td = [
            $('<td>').append(prop),
                $('<td>').append(obj.toString ? obj.toString() : obj)
        ];

        var tr = $('<tr>');
        tr.append(td[0]).append(td[1]);
        $('#alert-tbody').append(tr);
    }
    }

    $('#alert-error').removeClass('hide');
}

$(document).ready(function(){
    'use strict';
    DEBUG.log("Version jQuery", $.fn.jquery);

    // Default AWS region and v4 signature
    AWS.config.update({ region: '' });
    AWS.config.update({ signatureVersion: 'v4' });

    // Show navbuttons
    $('#navbuttons').removeClass('hide');

    // Close handler for the alert
    $('.alert .close').on('click', function(e) {
        $(this).parent().addClass('hide');
    });

    // Initialize the moment library (for time formatting utilities) and
    // launch the initial Settings dialog requesting bucket & credentials.
    moment().format();
    $('#SettingsModal').modal({ keyboard: true, backdrop: 'static' });
});
