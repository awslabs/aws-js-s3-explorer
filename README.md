# AWS JavaScript S3 Explorer (v2 alpha)

Note: if you are looking for the original, view-only version of this tool then please visit the [S3 Explorer](https://github.com/awslabs/aws-js-s3-explorer) page.

AWS JavaScript S3 Explorer (v2 alpha) is a JavaScript application that uses AWS's JavaScript SDK and S3 APIs to make the contents of an S3 bucket easy to browse via a web browser. We've created this to enable easier sharing and management of objects and data in Amazon S3.

The index.html, explorer.js, and explorer.css files in this bucket contain the entire application. A visitor to the index.html page is prompted to enter the name of an Amazon S3 bucket and optionally supply AWS credentials. Upon supplying the required information, the contents of the bucket will be rendered on the page.

**Important**: unless you explicitly want everyone on the internet to be able to read your S3 bucket, you should ensure that your S3 bucket is **not** public. You can read more at [Security Best Practices for Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/dev/security-best-practices.html).

## Screenshots

Default starting view for public S3 bucket:
![Main screen][main-public]

[main-public]: https://raw.githubusercontent.com/awslabs/aws-js-s3-explorer/v2-alpha/screenshots/explorer-main-public.png

Default starting view for private S3 bucket:
![Main screen][main-private]

[main-private]: https://raw.githubusercontent.com/awslabs/aws-js-s3-explorer/v2-alpha/screenshots/explorer-main-private.png

View all objects in folder:
![Folder selected screen][folder]

[folder]: https://raw.githubusercontent.com/awslabs/aws-js-s3-explorer/v2-alpha/screenshots/explorer-folder.png

View all objects in bucket:
![Bucket traversal screen][bucket]

[bucket]: https://raw.githubusercontent.com/awslabs/aws-js-s3-explorer/v2-alpha/screenshots/explorer-bucket.png

Upload objects to a bucket:
![Bucket upload request screen][bucket-upload]

[bucket-upload]: https://raw.githubusercontent.com/awslabs/aws-js-s3-explorer/v2-alpha/screenshots/explorer-upload.png

Upload objects to a bucket succeeded:
![Bucket upload confirmation screen][bucket-upload-success]

[bucket-upload-success]: https://raw.githubusercontent.com/awslabs/aws-js-s3-explorer/v2-alpha/screenshots/explorer-upload-success.png

Delete objects from a bucket:
![Bucket object delete request screen][bucket-delete]

[bucket-delete]: https://raw.githubusercontent.com/awslabs/aws-js-s3-explorer/v2-alpha/screenshots/explorer-delete.png

Delete objects from a bucket succeeded:
![Bucket object delete confirmation screen][bucket-delete-success]

[bucket-delete-success]: https://raw.githubusercontent.com/awslabs/aws-js-s3-explorer/v2-alpha/screenshots/explorer-delete-success.png

Bucket information:
![Bucket information screen][bucket-info]

[bucket-info]: https://raw.githubusercontent.com/awslabs/aws-js-s3-explorer/v2-alpha/screenshots/explorer-info.png

## Deployment and Use

Note that in the general case, you are working with two distinct S3 buckets:

1. the S3 bucket hosting this tool, let's call it BUCKET1
2. the S3 bucket that you intend to use this tool to explore, let's call it BUCKET2

To deploy S3 Explorer, you have to do the following:

1. store index.html, explorer.css, and explorer.js in BUCKET1
2. apply an S3 bucket policy to BUCKET1 that allows unauthenticated read of the 3 files

To launch and use S3 Explorer to explore BUCKET2 you have to do the following:

1. open the hosted index.html file in your browser at https://s3.amazonaws.com/BUCKET1/index.html
2. supply BUCKET2 as the bucket name
3. choose Private Bucket (I have AWS credentials)
4. supply your IAM credentials
5. click Query S3

More detailed configuration instructions follow.

### Configure the Bucket Hosting S3 Explorer

To launch the S3 Explorer, you need to make its files publicly readable. To do that, you will need to create a policy that allows anyone to see and access the S3 Explorer files.

Using the [AWS Console for S3](https://s3.console.aws.amazon.com/), click your bucket name in the bucket list, then click the *Permissions* tab, then click *Bucket Policy*. The *Bucket Policy Editor* panel will open up with a textfield where you can enter a policy for your bucket. Enter the following policy, but replace *BUCKET1* with the name of your bucket, then click *Save*:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3ExplorerGetMinimal",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:Get*",
      "Resource": [
        "arn:aws:s3:::BUCKET1/index.html",
        "arn:aws:s3:::BUCKET1/explorer.css",
        "arn:aws:s3:::BUCKET1/explorer.js"
      ]
    }
  ]
}
```

Note that this policy will allow anyone to get the listed files from the bucket, but it will *not* allow them to upload, modify, or delete files.

If you prefer to restrict the set of source IPs that can access the files then you can do this with an additional bucket policy condition on source IP address. Add the following policy fragment to the S3 bucket policy, replacing *203.0.113.0/24* with the relevant IP CIDR block:

```json
"Condition": {
    "IpAddress": {
        "aws:SourceIp": "203.0.113.0/24"
    }
}
```

### Configure Credentials for Using S3 Explorer

To access the contents of a private Amazon S3 bucket named BUCKET2, you will need to create an IAM policy that allows access to that bucket. You will also need to supply IAM credentials to S3 Explorer. An example IAM policy allowing access to BUCKET2 is provided below:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:List*",
        "s3:Get*",
        "s3:Put*",
        "s3:Delete*"
      ],
      "Resource": [
        "arn:aws:s3:::BUCKET2",
        "arn:aws:s3:::BUCKET2/*"
      ]
    }
  ]
}
```

Once you have created this IAM policy, you can attach the policy to an IAM user. IAM users with this policy can now use S3 Explorer to explore BUCKET2.

### Enabling CORS

In order for S3 Explorer hosted in BUCKET1 to explore the contents of BUCKET2, BUCKET2 needs to have the proper Cross-Origin Resource Sharing (CORS) configuration allowing web pages hosted in BUCKET1 to make requests to BUCKET2. You can do this by going to the Amazon S3 console at <https://console.aws.amazon.com/s3> and selecting BUCKET2.

CORS defines a way for client web applications that are loaded in one domain to interact with resources in a different domain.

Note that CORS configurations do not, in and of themselves, authorize the user to perform any actions on the bucket. They simply enable the browser's security model to allow a request to S3. Actual permissions for the user must be configured either via bucket permissions (for public access), or IAM permissions (for private access).

#### CORS for Read-Only S3 Bucket

If you intend to allow read-only access from BUCKET1, which hosts S3 Explorer, to BUCKET2, then you will need to supply a CORS configuration on BUCKET2 that permits HEAD and GET operations, for example:

```json
[
  {
    "AllowedHeaders": [
      "*"
    ],
    "AllowedMethods": [
      "HEAD",
      "GET"
    ],
    "AllowedOrigins": [
      "https://s3.amazonaws.com"
    ],
    "MaxAgeSeconds": 3000,
    "ExposeHeaders": [
      "ETag",
      "x-amz-meta-custom-header",
      "x-amz-server-side-encryption",
      "x-amz-request-id",
      "x-amz-id-2",
      "date"
    ]
  }
]
```

#### CORS for Writable S3 Bucket

If you intend to allow modifications to objects in BUCKET2, for example deleting existing objects or uploading new objects, then you will need to supply additional CORS configuration that permits PUT, POST and DELETE operations, for example:

```json
[
  {
    "AllowedHeaders": [
      "*"
    ],
    "AllowedMethods": [
      "HEAD",
      "GET",
      "POST",
      "PUT",
      "DELETE"
    ],
    "AllowedOrigins": [
      "https://s3.amazonaws.com"
    ],
    "MaxAgeSeconds": 3000,
    "ExposeHeaders": [
      "ETag",
      "x-amz-meta-custom-header",
      "x-amz-server-side-encryption",
      "x-amz-request-id",
      "x-amz-id-2",
      "date"
    ]
  }
]
```

### Regional S3 Buckets

If your S3 bucket is hosted outside of the US East (Northern Virginia) region (us-east-1) and you want to use path-style URLs to access the bucket's contents, then you should use a region-specific endpoint to access your bucket, for example <https://s3-us-west-2.amazonaws.com/BUCKET_NAME/index.html>.

To use path-style URLs, you should supplement your CORS configuration to include additional allowed origins representing the region-specific S3 endpoints, for example s3-us-west-2.amazonaws.com and s3.us-west-2.amazonaws.com, as follows:

```json
    "AllowedOrigins": [
      "https://s3.amazonaws.com",
      "https://s3-us-west-2.amazonaws.com",
      "https://s3.us-west-2.amazonaws.com"
    ]
```

### Static Website Hosting

Above, we indicated that users can access your index.html via one of two URLs:

* <https://s3.amazonaws.com/BUCKET-NAME/index.html> (path-style URL)
* <https://BUCKET-NAME.s3.amazonaws.com/index.html> (virtual-hosted-style URL)

You also have the option to enable 'Static Website Hosting' on your S3 bucket. If you do this with a bucket in the US East (N. Virginia) region then your user will additionally be able to use:

* <http://BUCKET-NAME.s3-website-us-east-1.amazonaws.com/>

If you choose to do this, then you will also need to modify the CORS configuration above to include:

```json
    "AllowedOrigins": [
      "https://s3.amazonaws.com",
      "https://BUCKET-NAME.s3.amazonaws.com"
    ]
```

Or as follows, if in a bucket outside of US East (N. Virginia):

```json
    "AllowedOrigins": [
      "https://s3.amazonaws.com",
      "https://BUCKET-NAME.s3.uw-west-2.amazonaws.com"
    ]
```

Note that when you configure a bucket for website hosting, the two general forms of an Amazon S3 website endpoint are as follows:

* bucket-name.s3-website-region.amazonaws.com
* bucket-name.s3-website.region.amazonaws.com

Note the dash (-) between s3-website and the region identifier. Which form is used for the endpoint depends on what Region the bucket is in. For a complete list, please see [Amazon S3 Website Endpoints](https://docs.aws.amazon.com/general/latest/gr/rande.html#s3_website_region_endpoints).

## Display Options

This application allows visitors to view the contents of a bucket via its folders or by listing out all objects in a bucket. The default view is by folder, but users can choose Initial View: Bucket in Settings to display all objects in the bucket. Note that viewing an entire bucket that contains many objects could overwhelm the browser. We&rsquo;ve successfully tested this application on a bucket with over 30,000 objects, but keep in mind that trying to list too many objects in a browser could lead to a poor user experience.

## Credentials

This tool can be used for publicly-readable S3 buckets (where no authentication is required) and for private S3 buckets (where authentication *is* required).

If you choose to explore a private S3 bucket then you will need to supply AWS credentials. Credentials can be provided in one of the following forms:

* IAM credentials: access key ID and secret access key
* IAM credentials with MFA: access key ID, secret access key, and authentication code from an MFA device
* STS credentials: access key ID, secret access key, and session token
