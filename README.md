# AWS JavaScript S3 Explorer

AWS JavaScript S3 Explorer is a JavaScript application that uses AWS's JavaScript SDK and S3 APIs to make the contents of an S3 bucket easy to browse via a web browser. We've created this to enable easier sharing of objects and data via Amazon S3. 

The index.html file in this bucket contains the entire application. A visitor to the index.html page is prompted to enter the name of an Amazon S3 bucket. Upon adding the bucket name, the contents of the bucket will be rendered on the page. 

## Enabling CORS

In order for JavaScript to display the contents of an Amazon S3 bucket, the bucket must have the proper cross-origin resource sharing (CORS) configuration. For security reasons, browsers normally block requests by JavaScript code to access URLs that are unrelated to the source of the code (such as the contents of your bucket), but with CORS, we can configure your bucket to explicitly enable JavaScript to do this.

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