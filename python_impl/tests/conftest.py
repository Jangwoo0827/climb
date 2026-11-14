import os
import sys

# python_impl 폴더의 route.py / reward.py 를 어디서 pytest를 돌려도 불러올 수 있게 함
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
