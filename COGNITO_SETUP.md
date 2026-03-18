# AWS Cognito Authentication Setup Guide

This guide will help you set up AWS Cognito authentication for your S3 Explorer to work with private S3 buckets.

## Step 1: Create AWS Cognito Identity Pool

1. **Open AWS Cognito Console**
   - Go to [AWS Cognito Console](https://console.aws.amazon.com/cognito/)
   - Select "Identity pools" (Federated Identities)

2. **Create a new Identity Pool**
   - Click "Create identity pool"
   - Enter a pool name: `s3-explorer-identity-pool`
   - Check "Enable access to unauthenticated identities" 
   - Click "Create Pool"

3. **Note your Identity Pool ID**
   - After creation, note the Identity Pool ID: `us-east-1:b63906d2-e472-479e-9450-ede901b0c914` ✅

## Step 2: Configure IAM Roles

The Cognito creation process will create two IAM roles. You need to modify the **unauthenticated role**:

1. **Find the Unauthenticated Role**
   - Go to IAM Console > Roles
   - Find the role: `service-role/s3-explorer-guest-role` (or similar)
   - This is the role with ARN: `arn:aws:iam::590183849536:role/service-role/s3-explorer-guest-role`

2. **Attach S3 Access Policy**
   - Click on the role
   - Click "Add permissions" → "Attach policies" 
   - Create a custom policy named `S3ExplorerBucketAccess` with this JSON:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:ListBucket",
                "s3:GetBucketLocation"
            ],
            "Resource": [
                "arn:aws:s3:::download2.pcamericademo",
                "arn:aws:s3:::download2.pcamericademo/*"
            ]
        }
    ]
}
```

## Step 3: Update S3 Bucket Policy

**IMPORTANT: Before applying this policy, you need to find the correct Cognito role ARN!**

1. **Find Your Cognito Role ARN:**
   - Go to [AWS IAM Console](https://console.aws.amazon.com/iam/) 
   - Click "Roles" in the left sidebar
   - Look for a role starting with `Cognito_s3exploreridentitypool` 
   - Click on the role and copy the full ARN (it should look like: `arn:aws:iam::470098897210:role/Cognito_s3exploreridentitypoolUnauth_Role`)

2. **Update the policy below with your actual role ARN** (replace the example ARN in the "AWS" principal)

Replace your current S3 bucket policy with this one that allows both CloudFront and Cognito access:

```json
{
    "Version": "2008-10-17",
    "Id": "PolicyForCloudFrontAndCognitoAccess",
    "Statement": [
        {
            "Sid": "AllowCloudFrontServicePrincipal",
            "Effect": "Allow",
            "Principal": {
                "Service": "cloudfront.amazonaws.com"
            },
            "Action": [
                "s3:GetObject",
                "s3:ListBucket",
                "s3:GetBucketLocation"
            ],
            "Resource": [
                "arn:aws:s3:::download2.pcamericademo",
                "arn:aws:s3:::download2.pcamericademo/*"
            ],
            "Condition": {
                "StringEquals": {
                    "AWS:SourceArn": "arn:aws:cloudfront::590183849536:distribution/E30CBEP37XQS7D"
                }
            }
        },
        {
            "Sid": "AllowCognitoGuestRole",
            "Effect": "Allow",
            "Principal": {
                "AWS": "arn:aws:iam::590183849536:role/service-role/s3-explorer-guest-role"
            },
            "Action": [
                "s3:GetObject",
                "s3:ListBucket",
                "s3:GetBucketLocation"
            ],
            "Resource": [
                "arn:aws:s3:::download2.pcamericademo",
                "arn:aws:s3:::download2.pcamericademo/*"
            ]
        }
    ]
}
```

**Important Notes:**
- Replace `s3-explorer-guest-role` with your actual role name if different
- Replace `470098897210` with your AWS account ID
- Replace `download2.pcamericademo` with your actual bucket name

## Step 4: Troubleshoot AccessDenied Errors

If you see "AccessDenied" errors after setup:

1. **Verify the Cognito Role:**
   - Go to Cognito → Identity pools → Your pool → Edit identity pool
   - Check "Unauthenticated role" is set to `s3-explorer-guest-role`

2. **Test the Role Permissions:**
   - Go to IAM → Roles → `s3-explorer-guest-role`
   - Click "Test role" and verify it can access S3

3. **Check S3 Bucket Policy:**
   - Ensure the bucket policy above is applied exactly
   - Verify the principal ARN matches your role ARN
   - Save the policy and wait 2-3 minutes for propagation

4. **Clear Browser Cache:**
   - Hard refresh the page (Ctrl+F5 or Cmd+Shift+R)
   - Or open in incognito/private browsing mode

## Step 5: Create Missing CloudFront Configuration File

Create a file named `s3_id.txt` in your web root with the S3 bucket location:

```
s3.amazonaws.com/download2.pcamericademo
```

## Step 6: Update Your Application Configuration

In your `index.html` file, find the `cognitoConfig` object and update it with your values:

```javascript
var cognitoConfig = {
    IdentityPoolId: 'us-east-1:b63906d2-e472-479e-9450-ede901b0c914', // Your actual Identity Pool ID ✅
    UserPoolId: 'us-east-1_yourUserPoolId', // Optional - only if using User Pool
    ClientId: 'your-app-client-id', // Optional - only if using User Pool  
    Region: 'us-east-1' // Your region
};
```

## Step 5: Remove Public Access from S3 Bucket

1. **Go to S3 Console**
   - Select your bucket (`download2.pcamericademo`)
   - Go to "Permissions" tab

2. **Block Public Access**
   - Click "Edit" on "Block public access settings"
   - Check all four boxes:
     - Block public access to buckets and objects granted through new access control lists (ACLs)
     - Block public access to buckets and objects granted through any access control lists (ACLs)  
     - Block public access to buckets and objects granted through new public bucket or access point policies
     - Block public access to buckets and objects granted through any public bucket or access point policies
   - Click "Save changes"

3. **Remove Public ACLs**
   - Go to "Access Control List (ACL)" tab
   - Remove any public permissions

## Step 6: Test Your Setup

1. **Deploy your updated `index.html`**
2. **Open the application**
   - You should see "Authenticating..." status
   - Once authenticated, status should change to "Authenticated" 
   - You should be able to browse your S3 bucket contents

## Troubleshooting

### Authentication Failed
- Check that your Identity Pool ID is correct
- Verify the IAM role has the correct S3 permissions
- Check browser console for detailed error messages

### Access Denied Errors
- Verify the S3 bucket policy includes the Cognito role
- Ensure the IAM role ARN in the bucket policy matches your actual role
- Check that the bucket name in policies matches your actual bucket

### CORS Issues
- Ensure your CORS configuration on the S3 bucket allows the necessary origins
- Your current CORS configuration should work, but you might need to add your domain

## Optional: User Pool Authentication

If you want to add user login/signup functionality:

1. Create a User Pool in Cognito
2. Create an App Client
3. Update the `cognitoConfig` with User Pool details
4. Add login/signup UI components
5. Use `AWS.CognitoIdentity` for authentication flows

## Security Considerations

- The current setup uses unauthenticated identities (anonymous access)
- All users get the same level of access
- Consider implementing User Pools for individual user authentication
- Monitor CloudTrail logs for unusual access patterns
- Consider implementing additional conditions in your policies (IP restrictions, time-based access, etc.)

## Cost Considerations

- Cognito Identity Pool has free tier: 50,000 monthly active users
- S3 requests will now be authenticated (may have different pricing)
- CloudFront costs remain the same