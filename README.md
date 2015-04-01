# AWS JavaScript S3 Explorer

AWS JavaScript S3 Explorer is a JavaScript application that uses AWS's JavaScript SDK and S3 APIs to make the contents of an S3 bucket easy to browse via a web browser. We've created this to enable easier sharing of objects and data via Amazon S3. 

The index.html file in this bucket contains the entire application. A visitor to the index.html page is prompted to enter the name of an Amazon S3 bucket. Upon adding the bucket name, the contents of the bucket will be rendered on the page. 

## Setting Bucket Permissions and Enabling CORS

In order for JavaScript to display the contents of an Amazon S3 bucket, the bucket must be readable by anyone and have the proper cross-origin resource sharing (CORS) configuration. You can do this by going to the Amazon S3 console at https://console.aws.amazon.com/s3 and selecting your bucket.

### Setting Bucket Permissions

To share the contents of an Amazon S3 bucket, you will need to create a policy that allows anyone to see and access the contents of your bucket. To do this, you need to update the bucket policy. 

Select your bucket in the buckets panel and click to reveal *Permissions* in the *Properties* pane. Click *Edit Bucket Policy*. The *Bucket Policy Editor* panel will open up with a field where you can enter a policy for your bucket. Enter the following policy, but replace *BUCKET-NAME* with the name of your bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": {
        "AWS": "*"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::BUCKET-NAME/*"
    }
  ]
}
```


### CORS Configuration

For security reasons, browsers normally block requests by JavaScript code to access URLs that are unrelated to the source of the code (such as the contents of your bucket), but with CORS, we can configure your bucket to explicitly enable JavaScript to do this.

To configure your bucket to allow cross-origin requests, you create a CORS configuration, which is an XML document with rules that identify the origins that you will allow to access your bucket, the operations (HTTP methods) will support for each origin, and other operation-specific information. 

To do this, select your bucket in the buckets panel within the Amazon S3 Console and click to reveal Permissions in the Properties pane. Click Edit CORS Configuration. The CORS Configuration Editor panel will open up with a field where you can enter a CORS Configuration. Enter the following configuration:


```xml
<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <CORSRule>
        <AllowedOrigin>*</AllowedOrigin>
        <AllowedMethod>GET</AllowedMethod>
        <MaxAgeSeconds>3000</MaxAgeSeconds>
        <AllowedHeader>*</AllowedHeader>
    </CORSRule>
</CORSConfiguration>
```

## Display Options

This application allows visitors to view the contents of a bucket via its folders or by listing out all objects in a bucket. The default view is by folder, but users can click on &ldquo;Bucket&rdquo; toward the top-right of the page to display all objects in the bucket. Note clicking on &ldquo;Bucket&rdquo; will load all objects in the bucket into the browser. If your bucket contains many objects, this could overwhelm the browser. We&rsquo;ve successfully tested this application on a bucket with over 30,000 objects, but keep in mind that trying to load too many objects in a browser could lead to a poor user experience.