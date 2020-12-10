import os, sys, getopt, boto3
from botocore.exceptions import NoCredentialsError

from s3_add_file import copy_file


def rewrite_index(in_file, out_file, bucket_name):
    file = open(in_file, "r")
    line = file.readline()
    lines = []
    while line:
        if "s3exp_config.Bucket = " in line:
            line = line[0:line.index("\"")] + "\"" + bucket_name + "\"\n"
        lines.append(line)
        line = file.readline()

    file.close()    
    custom_index = "".join(lines)
    
    file = open(out_file, "w")
    file.write(custom_index)
    file.close()


def print_help():
    print('\nUsage: python s3-add-custom-index.py -o <s3:bucket_name>\n')


def main(argv):
    s3_bucket = ''

    if len(argv) < 2:
        print_help()
        sys.exit(2)

    try:
        opts, argv = getopt.getopt(argv,"o:", ["output="])
    except getopt.GetoptError:
        print_help()
        sys.exit(2)

    for opt, arg in opts:
        if opt == '-h':
            print_help()
            sys.exit()
        elif opt in ("-o", "--output"):
            s3_bucket = arg

    rewrite_index("index-src.html", "index.html", s3_bucket)
    copy_file("index.html", s3_bucket)
    

if __name__ == "__main__":
   main(sys.argv[1:])