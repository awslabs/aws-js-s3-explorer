import os, sys, getopt, boto3
from botocore.exceptions import NoCredentialsError


def upload_file(s3client, bucket, local_file, s3_file, content_type):
    try:
        s3client.upload_file(local_file, bucket, s3_file, ExtraArgs={'ContentType': content_type})
        print(local_file + " uploaded to " + s3_file)
        return True
    except OSError:
        print("The file was not found: ")
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


def copy_file(in_file, s3_bucket_name):
    s3client = boto3.client('s3')
    folders = list_folders(s3client, s3_bucket_name, "", [".svn/"])
    folders.append("")

    filename = in_file
    if "/" in filename:
        filename = filename[filename.rindex("/") + 1:]
    
    print("Will copy ", filename , " to " , len(folders) , " folders and subfolders")

    for folder in folders:
        upload_file(s3client, s3_bucket_name, in_file, folder + filename, "text/html")



def print_help():
    print('\nUsage: python s3-add-file.py -i <input:file> -o <s3:bucket_name>\n')


def main(argv):
    in_file = ''
    s3_bucket = ''

    if len(argv) < 4:
        print_help()
        sys.exit(2)

    try:
        opts, argv = getopt.getopt(argv,"i:o:", ["input=","output="])
    except getopt.GetoptError:
        print_help()
        sys.exit(2)

    for opt, arg in opts:
        if opt == '-h':
            print_help()
            sys.exit()
        elif opt in ("-i", "--input"):
            in_file = arg
        elif opt in ("-o", "--output"):
            s3_bucket = arg

    copy_file(in_file, s3_bucket)

    

if __name__ == "__main__":
   main(sys.argv[1:])