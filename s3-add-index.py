import os, boto3
from botocore.exceptions import NoCredentialsError

s3 = boto3.resource('s3')
bucket_name = "geneontology-tmp"
bucket = s3.Bucket(bucket_name)

def upload_file(s3client, bucket, local_file, s3_file, content_type):
    try:
        s3client.upload_file(local_file, bucket, s3_file, ExtraArgs={'ContentType': content_type})
        print(local_file + " uploaded to " + s3_file)
        return True
    except FileNotFoundError:
        print("The file was not found")
        return False
    except NoCredentialsError:
        print("Credentials not available")
        return False

def list_folders(s3client, bucket, initial_prefix = "", ignore_folders=[]):
    paginator = boto3.client('s3').get_paginator('list_objects')
    folders = []
    iterator = paginator.paginate(Bucket=bucket, Prefix=initial_prefix, Delimiter='/', PaginationConfig={'PageSize': None})
    for response_data in iterator:
        prefixes = response_data.get('CommonPrefixes', [])
        for prefix in prefixes:
            prefix_name = prefix['Prefix']
            if prefix_name.endswith('/'):
                if any(ignore in prefix_name for ignore in ignore_folders):
                    continue                
                folders.append(prefix_name)
                print("iterate " , prefix_name)
                subs = list_folders(s3client, bucket, prefix_name, ignore_folders)
                if len(subs) > 0:
                    folders.extend(subs)
    return folders

s3client = boto3.client('s3')
folders = list_folders(s3client, bucket_name, "", [".svn/"])
folders.append("")

for folder in folders:
    upload_file(s3client, bucket_name, "index.html", folder + "index.html", "text/html")