import os, sys, getopt, boto3
from botocore.exceptions import NoCredentialsError

from s3_add_file import copy_file


def rewrite_index(in_file, bucket_name):
    file = open(in_file, "r")
    line = file.readline()
    lines = []
    while line:
        line = file.readline()
        if "s3exp_config.Bucket = " in line:
            line = line[0:line.index("\"")] + "\"" + bucket_name + "\"\n"
        lines.append(line)

    file.close()    
    custom_index = "".join(lines)
    
    file = open("toto.html", "w")
    file.write(custom_index)
    file.close()


def print_help():
    print('\nUsage: python s3-add-custom-index.py -i <input:index_file> -o <s3:bucket_name>\n')


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

    rewrite_index(in_file, s3_bucket)
    copy_file(in_file, s3_bucket)
    

if __name__ == "__main__":
   main(sys.argv[1:])