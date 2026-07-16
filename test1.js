// ❌ 删掉这行：const axios = require("axios");
//  改成这行：
import axios from "axios";

async function login() {
  const url = "http://localhost:8888/api/login";
  //   const data = {
  //     username: "1",
  //     password: "!Aa123123",
  //   };

  try {
    const response = await axios.post(
      "http://localhost:8888/api/login",
      {
        username: "1",
        password: "!Aa123123",
      },
      {
        proxy: false, // ❌ 禁用 Node.js 的全局代理，强制走本地直接连接
      },
    );
    const result = response.data;
    console.log("登录成功，返回结果：", result);
  } catch (error) {
    console.error("登录失败:", error.message);
  }
}

login();
