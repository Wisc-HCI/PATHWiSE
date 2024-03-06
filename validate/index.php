<?php

 if (!empty($_POST))
 {
    // Array of post values for each different form on your page.
    $postNameArr = array('save', 'fetch');        

    // Find all of the post identifiers within $_POST
    $postIdentifierArr = array();
        
    foreach ($postNameArr as $postName)
    {
        if (array_key_exists($postName, $_POST))
        {
             $postIdentifierArr[] = $postName;
        }
    }

    // Only one form should be submitted at a time so we should have one
    // post identifier.  The die statements here are pretty harsh you may consider
    // a warning rather than this. 
    if (count($postIdentifierArr) != 1)
    {
        count($postIdentifierArr) < 1 or
            die("\$_POST contained more than one post identifier: " .
               implode(" ", $postIdentifierArr));

        // We have not died yet so we must have less than one.
        die("\$_POST did not contain a known post identifier.");
    }

    $servername = "localhost";
    $username = "root";
    $password = "";
    $dbname = "pathwise_prototype";
    // Create connection
    $mysqli = new mysqli($servername, $username, $password, $dbname);
    // Check connection
    if ($mysqli->connect_error) {
        die("Connection failed: " . $mysqli->connect_error);
    } 

    switch ($postIdentifierArr[0])
    {
    case 'save':
        $data = $_POST['save'];
        $pins = $mysqli->real_escape_string($data["pins"]);
        $redactors = $mysqli->real_escape_string($data["redactors"]);
        $meta = $mysqli->real_escape_string($data["meta"]);
        $uid = $mysqli->real_escape_string($data["uid"]);
        $article = $mysqli->real_escape_string($data["article"]);
        $group = $mysqli->real_escape_string($data["group"]);
        $sql = "INSERT INTO `saved_responses` (`pins`, `redactors`, `meta`, `uid`, `group`, `article`) VALUES ('$pins', '$redactors', '$meta', '$uid', '$group', '$article')";
        if ($mysqli->query($sql) === TRUE) {
            echo "Saved the progress successfully!";
        } else {
            echo "Error: " . $sql . "<br>" . $mysqli->error;
        }
        break;

    case 'fetch':
        $data = $_POST['fetch'];
        $article = $mysqli->real_escape_string($data["article"]);
        $group = $mysqli->real_escape_string($data["group"]);
        $sql = "SELECT `pins` FROM `saved_responses` WHERE `group` = '$group' AND `article` = '$article' ORDER BY `tiemstamp` DESC LIMIT 1";
        $result = $mysqli->query($sql);
        $response['status'] = false;
        if ($result->num_rows > 0) {
            while($row = $result->fetch_assoc()) {
                $response['pins'] = $row["pins"];
            }
            if($response['pins'] != '[]') {
                $response['status'] = true;
            }
        }
        echo(json_encode($response));
        break;
    }

    $mysqli->close();
}
else // $_POST is empty.
{
    header('Location: /');
}
?>